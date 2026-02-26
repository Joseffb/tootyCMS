# Tooty CMS Roadmap (Priority Order)

## P0: Production-Blocking

1. Complete RBAC with capability matrix for core site roles (`administrator|editor|author`) and network role (`network admin`), with plugin-extensible roles (for example `subscriber` via membership plugin); remove owner/admin one-offs.
2. Add shared permission middleware/helpers used consistently across server actions, API routes, and UI visibility.
3. Add migration system + admin "Database Update Required" flow with explicit apply action and schema version tracking.
4. Enforce fail-safe setup lifecycle (`not_configured -> configured -> migrated -> ready`) and prevent partial states.
5. Harden auth account linking and user provisioning rules (no unsafe auto-linking).
6. Complete scheduler execution reliability model (retries, backoff, dead-letter, per-run audit records).
7. Finalize trace pipeline contract (JSONL sink, rotation/retention, structured `error|warn|info` levels).
8. Add secrets safety guardrails in CI (scan for tokens/keys before commit/build/deploy).

## P1: Core CMS Completeness

9. Finish data-domain parity so all domains behave like post/page (editor, media, taxonomy, API, routes, templates).
10. Finalize permalink engine with per-site tokenized patterns, canonical URLs, deterministic redirects.
11. Implement complete template hierarchy contract (`archive|single|taxonomy|404|home`) for all domains.
12. Add schema/index hardening for scale (domain entries, terms, relationships, schedules, analytics lookups).
13. Add reliable seed/bootstrap tooling that is never run implicitly during normal requests.
14. Add robust media pipeline (validation, transforms, remote/local providers, cleanup jobs, quotas).
16. Add draft/publish workflow states and scheduled publish/unpublish transitions.

## P1.5: Platform Foundations (Cross-Domain Systems)

17. Add pluggable Search system via spine/registration model (provider contract + routing/query adapters), including a native DB-backed provider in core as baseline.

## P2: Multi-Tenant + Network Operations

P2-0. Add core comment service (provider contract, RBAC-first orchestration, tenant-scoped context, trace logging, migration-managed schema), with full unit/integration/e2e coverage.
P2-1. Add central signing system service (non-enforcing dev mode, enforce-capable production mode), including reserved-subdomain lookup support for external verification flows.
P2-2. Add external public REST API module in core (`/api/v1/*`), versioned and tenant-scoped, RBAC-gated; keep internal `/app/api/*` as non-public plumbing.
P2-3. Add autosave, revisions, and restore history for editable content types.
18. Enforce tenant isolation everywhere (queries, cache tags, theme queries, scheduler jobs, analytics).
19. Finish network query governance (main site + permissioned sites only, audited access).
20. Add site-level limits/quotas (entries, media, scheduler jobs, API usage).
21. Add admin tools for tenant lifecycle (archive, export, transfer ownership, disable safely).
22. Add safe background jobs for cross-site operations (reindex, cache warm, sitemap rebuild).

## P3: Extension Platform Maturity

22. Publish stable plugin/theme API versioning policy and compatibility checks at load time.
23. Add extension sandbox limits (timeouts, payload limits, query limits, side-effect restrictions).
24. Add extension test harness for contract validation (themes/plugins must pass before enable).
25. Add scheduler hooks for plugins/themes with ownership-scoped CRUD + execution registration.
26. Add marketplace-ready packaging conventions and signature checks.

## P4: Developer Experience + Delivery

27. Add release discipline (changelog, semver policy, upgrade notes, migration notes per version).
28. Add CI matrix (lint, unit, integration, build, security scan, migration smoke tests).
29. Add local dev tooling for sync workflows (core upstream sync script, conflict guidance, checks).
31. Add comprehensive API docs (internal actions + route contracts + examples).
32. Add observability dashboard (scheduler health, auth failures, query failures, extension failures).
33. Add disaster recovery docs and tooling (DB backup/restore, media backup, rollback runbook).

## Definition of "Solid CMS" (Exit Criteria)

34. Zero known permission bypasses in audit.
35. Deterministic upgrades with automated migration checks.
36. Full domain parity (no post special-case behavior).
37. Stable extension contracts with compatibility enforcement.
38. Reproducible build/deploy and green CI on every release.
39. Operational runbooks for incidents, rollback, and recovery.
