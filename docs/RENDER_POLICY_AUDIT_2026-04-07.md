# Render Policy Audit — 2026-04-07

Contract baseline: `docs/RENDER_POLICY.md`.

## Scope

Public-surface audit across:

- `app/[domain]/**`
- non-admin public surfaces:
  - `app/page.tsx`
  - `app/home/page.tsx`
  - `app/setup/page.tsx`
  - `app/sitemap.xml/route.tsx`
  - `app/robots.txt/route.ts`

## Method

Inspected route files for:

- `export const dynamic`
- `export const revalidate`
- `export const fetchCache`
- fetch `cache: "no-store"` behavior

## A) Violations

1. `app/sitemap.xml/route.tsx` — `dynamic = "force-dynamic"` (line 8)
   - Reason: non-admin public route is unconditionally request-time rendered in production.

## B) Source-level partial remediation

- `app/page.tsx` now declares `revalidate = 60`, with development-only `unstable_noStore()` inside the route body.
- `app/[domain]/page.tsx` now declares `revalidate = 60`, with development-only `unstable_noStore()` inside the route body.

However, executed build output is still environment-sensitive on the current tree:

- `npm run test` (`next build`) classified both `/` and `/[domain]` as dynamic (`ƒ`) routes.
- `npm run test:integration` classified `/` as dynamic (`ƒ`) and `/[domain]` as SSG (`●`).

Cache-first compliance is therefore not yet deterministic in executed output.

## C) Ambiguous routes

These routes are public-surface files with no explicit `dynamic`, `revalidate`, or `fetchCache` declaration in-file:

- `app/[domain]/layout.tsx`
- `app/[domain]/[slug]/page.tsx`
- `app/[domain]/[slug]/[child]/page.tsx`
- `app/[domain]/c/[slug]/page.tsx`
- `app/[domain]/t/[slug]/page.tsx`
- `app/[domain]/[slug]/not-found.tsx`
- `app/[domain]/[slug]/opengraph-image.tsx` (`runtime = "edge"` only)
- `app/home/page.tsx`
- `app/setup/page.tsx`
- `app/robots.txt/route.ts`

## D) Summary

Counted public route files audited: **13**

- Explicit violation still present: **1/13 (7.7%)**
- Source-level partial remediation applied: **2/13 (15.4%)**
- Ambiguous (no explicit render/cache declaration): **10/13 (76.9%)**

### Verdict

The public entry points `/` and `/[domain]` now have source-level ISR declarations, but executed build output is not yet stable across validation environments. The public sitemap route also remains an explicit violation, and most audited public surfaces remain implicit rather than explicit.

Current state is therefore:

**source-level progress toward cache-first, but not yet contract-compliant in executed output**
