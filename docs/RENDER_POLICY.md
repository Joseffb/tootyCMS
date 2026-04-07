# Render Policy Contract

## Purpose

Define deterministic rendering behavior across surfaces so that:
- public routes are cache-first
- admin routes remain dynamic
- behavior is verifiable, not inferred

This contract is enforceable and auditable.

---

## Surface Classification

### PUBLIC

Routes:
- app/[domain]/**
- any non-admin public-facing routes

Policy:
- Development: dynamic allowed
- Production: MUST be cache-first (ISR / static / tagged cache)

Forbidden:
- dynamic = "force-dynamic"
- revalidate = 0
- fetchCache = "force-no-store"

Allowed:
- revalidate > 0
- cache tags (unstable_cache, fetch tags)
- partial dynamic islands
- dev-only `unstable_noStore()` to preserve local correctness while keeping production cache-first

Invariant:
Public routes must not execute full render on every request in production.

---

### ADMIN

Routes:
- app/app/**

Policy:
- Always dynamic
- No caching
- Node runtime preferred

---

### API

Policy:
- Must explicitly declare runtime:
  - Edge: read-only, stateless
  - Node: DB / side-effects

---

## Next.js Rendering Semantics (Authoritative)

- Static/ISR: rendered at build or revalidation, served from cache
- Dynamic: rendered at request time for every request
- `dynamic = "force-dynamic"` disables caching
- `revalidate = 0` disables caching
- Next.js is static-first; dynamic must be explicitly opted into
- Static and dynamic modes must not switch at runtime

---

## Audit Rules

A route is a violation if:

- It is public AND:
  - uses force-dynamic
  - or revalidate = 0
  - or no-store fetch as default behavior

A route is compliant if:

- It uses ISR or static rendering with controlled invalidation

---

## Philosophy

Tooty is:

NOT:
- a dynamic CMS with caching

BUT:
- a cache-first CMS with dynamic exceptions

---

## Enforcement (Recommended)

Use repo scans:

- rg 'force-dynamic' app
- rg 'revalidate = 0' app

Public routes must not match these patterns.

---

## Outcome

This contract ensures:
- predictable performance
- correct Vercel usage
- clear separation of admin vs public behavior
