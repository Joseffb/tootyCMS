# Dev Tracker

Working tracker for active quality gates, known issues, and deferred validation work in core.

This file is operational, not aspirational. Keep it current when a blocker is discovered, paused, fixed, or verified.

## Status Legend

- `open`: known issue or unverified work remains
- `in_progress`: actively being fixed or validated
- `blocked`: cannot continue without an architectural decision or external dependency
- `verified`: fixed and explicitly re-tested

## Current Release Gate

Before any version bump, commit, or push for core:

1. `npm run test`
2. `npm run test:integration`

Both must pass on the current tree.

Current tree status:

- `npm run test`: passed
- `npm run test:integration`: passed

## Active Items

### 7. Integration harness slot-lock cleanup race

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/scripts/test-integration.sh`
- Scope:
  - prevent overlapping integration runs from releasing the test-slot lock before the prior slot owner has fully torn down its server
  - persist per-slot Next production server logs for future harness debugging
- Affected surfaces:
  - shared integration harness stability
  - multi-run/local overlapping validation workflows
  - public/theme-bridge availability during Playwright matrices
- Result:
  - cleanup now tears down the temporary server before releasing the slot lock
  - the reproduced shared-load subset that had been failing with `ERR_CONNECTION_REFUSED` and closed browser contexts now passes
  - full `npm run test:integration` is green on the fixed harness

### 6. Temp draft create flow normalization

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/create-domain-post-button.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/create-domain-post-form.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/site/[id]/domain/[domainKey]/create/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/site/[id]/domain/[domainKey]/create/draft/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/request-origin.ts`
- Scope:
  - remove the explicit draft UX step
  - enter the editor directly through the existing temp-draft persistence model
  - make proxied `*.test` create redirects host-safe instead of leaking `localhost:3000`
- Affected surfaces:
  - content create button
  - create route shell
  - temp-draft redirect behavior behind local reverse proxy hosts
  - lifecycle editor entry flow
- Required validation:
  1. focused create-route/component tests
  2. targeted lifecycle create/editor flow
  3. `npm run test`
  4. `npm run test:integration`
- Result:
  - content creation now enters the editor through the temp-draft flow without an explicit draft-mode step
  - proxied `*.test` create redirects stay host-safe instead of leaking `localhost:3000`
  - full gates are green on the current tree

### 5. Generic editor tab extensions for plugin-owned hidden article meta

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/editor/editor.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/api/plugins/editor/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/extension-contracts.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/extension-api.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-custom-plugins/tooty-story-teller`
  - `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-custom-themes/robert-betan-sub/templates/index.html`
- Scope:
  - add a governed plugin editor-tab contract for the existing item editor
  - persist plugin tab state into namespaced hidden article meta
  - remove Story Teller's standalone plugin workspace/menu dependence and move its UI into the editor rail
- Affected surfaces:
  - editor right-rail tabs
  - plugin admin extension contracts
  - hidden article meta persistence
  - Robert Betan Sub article detail rendering
- Result:
  - core editor-tab contract, editor API payload, hidden plugin article meta API, and Story Teller editor-only integration are implemented
  - focused contract/editor/api tests are green
  - full `npm run test` is green
  - full `npm run test:integration` is green on the current tree

### 0. Admin UI style guide hardening for structured inputs

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/PLUGIN_ADMIN_UX.md`
- Scope:
  - formalize the admin UX rule that normal admin flows must use structured controls instead of raw JSON fields
- Affected surfaces:
  - plugin admin apps
  - core admin settings surfaces
  - future extension review guidance
- Result:
  - added an explicit style-guide rule preferring dropdowns, creatable selects, toggles, repeaters, key/value editors, and other structured controls over raw JSON inputs
  - limited raw JSON to clearly labeled advanced/debug/import scenarios only
- Validation:
  - docs-only change

### 1. Article editor persistence lifecycle

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/editor/editor.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/actions.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/domain-post-save-action.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/e2e/site-lifecycle.spec.ts`
- Symptom:
  - reopening a newly created article editor in WebKit can hydrate with a blank/default draft payload
  - title, slug, and content are lost in the reopened editor even after initial save
- Latest failing assertion:
  - `tests/e2e/site-lifecycle.spec.ts`
  - article editor lifecycle
  - expected title input to equal the saved draft title
  - actual value was empty string
- Current understanding:
  - route normalization is fixed
  - taxonomy helper flakiness was fixed
  - the original blank-save failure was resolved by editor field-state/reconciliation hardening
  - the remaining page-title/permalink persistence failure was caused by `updateDomainPost(...)` falling through a duplicate-id placeholder recovery path and returning the existing row without applying the requested patch
  - mutation authorization now receives the requested site hint up front
  - duplicate-id recovery now applies the pending update instead of returning stale data
- Result:
  - targeted browser lifecycle repros pass
  - the full `site-lifecycle` spec passes across the 4-browser matrix
  - full `npm run test` and `npm run test:integration` are green on the current tree
- Required validation after fix:
  1. `bash ./scripts/test-integration.sh tests/e2e/site-lifecycle.spec.ts --project=webkit`
  2. `npm run test`
  3. `npm run test:integration`

### 2. Scheduler ownership refactor

- Status: `open`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/api/cron/run/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/scheduler.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/settings/schedules/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/site/[id]/settings/schedules/page.tsx`
- Locked contract:
  - one central network cron endpoint
  - network cron runs network-level schedules and cascades into site scheduler checks
  - site schedules are site-owned
  - site schedules default to enabled
  - network schedules are only for network-level work
- Required validation after implementation:
  1. unit/integration coverage for network scope vs site scope
  2. scheduled publish coverage through the scheduler
  3. `npm run test`
  4. `npm run test:integration`

### 3. Domain admin detail route normalization

- Status: `verified`
- Area:
  - canonical route should be `/app/{alias}/site/{siteId}/domain/{domainKey}/item/{postId}`
- Result:
  - `/item/{postId}` is the canonical admin detail route
  - compatibility redirect from legacy `/post/{postId}` remains in place
  - targeted lifecycle/editor flows are green
  - full `npm run test` is green
  - full `npm run test:integration` is green

### 4. Hidden content meta hard cutover

- Status: `verified`
- Area:
  - `_view_count`
  - `_publish_at`
  - editor meta visibility and inline editing
- Locked contract:
  - hidden meta keys do not render in visible editor meta fields
  - `_view_count` is canonical storage
  - `_publish_at` is hidden scheduled-publish storage
- Result:
  - `_view_count` is canonical storage
  - DB compatibility migration coverage exists for legacy `view_count` rows
  - no legacy `view_count` runtime reads remain in active paths outside compatibility/migration handling
  - focused unit coverage is green
  - lifecycle coverage including scheduled publish is green
  - full `npm run test` and `npm run test:integration` are green on the current tree

## Deferred But Intentional

### Eventual consistency on pooled Postgres reads

- Status: `accepted`
- Decision:
  - keep pooled Postgres only
  - do not add a direct/non-pooled runtime read path
- Consequence:
  - admin read-after-write can be temporarily stale
  - tests and UI should tolerate convergence where appropriate
- Do not reopen this unless there is unacceptable user-facing breakage, not just momentary lag

## Resume Checklist

When resuming paused work:

1. Re-read this tracker.
2. Reproduce the top `open` item first.
3. Fix the owning component, not only the test symptom.
4. Add regression coverage for the root cause.
5. Rerun the exact targeted failing path.
6. Only then rerun full gates.

## Closeout Checklist

An item can move to `verified` only when:

1. the runtime fix is in place
2. a targeted regression test exists
3. the targeted failing command passes
4. both full gates pass:
   - `npm run test`
   - `npm run test:integration`
