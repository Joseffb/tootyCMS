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

### 13. Domain admin cards/list view toggle

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/site/[id]/domain/[domainKey]/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/domain-posts.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/domain-post-list-table.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/domain-post-admin-view.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/domain-post-admin-routes.test.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/domain-posts.test.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/site-domain-posts-page.test.tsx`
- Scope:
  - add a generic list view alongside the existing domain-post card grid
  - keep the current card grid as the default view
  - use a query-param-backed admin view toggle that can work for any data domain and remember the last selected view
- Affected surfaces:
  - site domain admin listing
  - operator scan/edit workflow for posts and other domain-backed entries
  - admin route/query-param view state
- Current notes:
  - implemented a WordPress-style top-right cards/list toggle on the site domain admin page
  - list view now renders a structured row/table workspace while cards remain the default
  - current view is remembered through a cookie-backed preference, with query params still taking precedence
  - focused Vitest coverage is green for page toggle state, list rendering, and canonical edit/view links
  - isolated worktrees now resolve relative `THEMES_PATH` and `PLUGINS_PATH` entries against the primary repo root when the worktree-local sibling path is missing, so shared plugin/theme repos stay discoverable in runtime and integration flows
  - the site lifecycle e2e helper now performs a final editor-surface readiness check before timing out, which removed a Firefox timeout boundary flake on the page editor persistence step
  - full `npm run test` is green on this branch
  - full `npm run test:integration` is green on this branch across `chromium`, `firefox`, `webkit`, and `edge`

### 11. GitHub Core CI portability for `vercel:dev` wrapper tests

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/vercel-dev-script.test.ts`
- Scope:
  - keep wrapper tests portable across local machines and GitHub runners
  - prevent local absolute paths from breaking CI
- Affected surfaces:
  - `Core CI` unit-test job
  - local wrapper regression coverage
- Current notes:
  - GitHub failed on commit `3dcd641` because `tests/vercel-dev-script.test.ts` read `/Users/joseffbetancourt/.../scripts/vercel-dev.sh` directly
  - fixed by resolving `scripts/vercel-dev.sh` from `process.cwd()` instead of a machine-specific absolute path
  - revalidated with full `npm run test` and full `npm run test:integration`

### 9. Editor autosave loop under local `vercel dev`

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/editor/editor.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/admin-mutable-pages.test.ts`
- Scope:
  - stop the article editor from re-queuing saves indefinitely while idle under `pnpm vercel:dev`
  - keep one autosave coordinator for content, taxonomy, and meta state
- Affected surfaces:
  - article editor content autosave
  - local `vercel dev` authoring workflow
  - save-status settling after server-action refreshes
- Current notes:
  - root cause on persisted `/domain/{domainKey}/item/{postId}` pages was a split autosave model plus overly permissive local session recovery, which allowed server-action reconciliation and browser-restored field state to re-arm autosave while the page was idle
  - fixed by:
    - keeping one autosave coordinator
    - making persisted item sessions passive until a fresh user interaction re-arms mutation handling
    - clearing saved-session cache state after successful persistence so persisted items no longer bootstrap from stale local drafts
  - verified with focused Vitest coverage and a dedicated Playwright regression that leaves an existing persisted item page idle and asserts there are no background autosave POSTs

### 10. Editor taxonomy reference eager-load loop on persisted item pages

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/editor/editor.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/editor-taxonomy-loading.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/editor-taxonomy-loading.test.ts`
- Scope:
  - stop repeated `/api/editor/reference?...taxonomy=category|tag` GET loops on persisted item pages
  - make eager taxonomy loading distinguish `loaded and empty` from `not loaded yet`
- Affected surfaces:
  - category/tag reference loading in the editor
  - local `vercel dev` persisted item authoring flow
  - eager taxonomy hydration under pooled and dev-mode rerenders
- Current notes:
  - root cause was leftover client bootstrap/fallback logic on persisted item pages even though the route already server-seeded category and tag reference data
  - fixed by:
    - removing the client-side persisted-item fallback fetch path for editor reference data
    - making eager `category` and `tag` loads fail closed to seeded/cache state on persisted item pages
    - treating loaded-empty eager taxonomies as settled instead of “not loaded yet”
    - making `/api/editor/reference?taxonomy=category|tag` fail closed so persisted item editors cannot silently fall back to a deprecated eager-taxonomy compatibility read path
    - normalizing taxonomy keys before the fail-closed route check so stale or mixed-case clients cannot bypass the eager-taxonomy guard
    - forcing `vercel:dev` to start from a clean `.next-vercel-dev` tree so local stale bundles cannot preserve deprecated eager-taxonomy fetch behavior across restarts
  - verified with focused source-level tests plus a dedicated Playwright regression that opens `More` on an existing persisted item page and asserts there is no repeated `/api/editor/reference?...taxonomy=category|tag` loop

### 8. Local `vercel dev` isolation and lock clarity

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/scripts/vercel-dev.sh`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/scripts/prepare-next-tsconfig.mjs`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/package.json`
- Scope:
  - make `pnpm vercel:dev` use a managed Vercel-specific tsconfig
  - suppress the Vercel CLI self-upgrade prompt that can crash healthy local sessions
  - fail fast with a clear lock-owner error instead of letting `vercel dev` proxy a broken split-brain session
- Affected surfaces:
  - local Vercel dev workflow
  - `.next-vercel-dev` lock handling
  - root `tsconfig.json` churn from Vercel-specific dist types
- Result:
  - `vercel:dev` now disables the upgrade prompt via `NO_UPDATE_NOTIFIER=1`
  - it generates and uses a managed Vercel-only tsconfig
  - it aborts clearly when another Vercel dev session already owns the lock, instead of surfacing a confusing proxy 404
  - it now also aborts when any repo-local `next dev` or `vercel dev` process is already running for `tooty-cms`, because split local runtimes were able to revive stale route bundles and produce editor-only behavior that no longer matched current source

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

### 1. Article editor persistence lifecycle and direct taxonomy persistence

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/components/editor/editor.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/actions.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/domain-post-save-action.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/e2e/site-lifecycle.spec.ts`
- Result:
  - taxonomy changes now persist through the direct editor save path instead of waiting on the general draft autosave queue
  - temp and permanent article state now share the same taxonomy persistence behavior
  - the article editor lifecycle is green across the full browser matrix, including title/permalink persistence, taxonomy persistence, scheduling, publish, and public verification
- Affected surfaces:
  - editor taxonomy chips and taxonomy add/select UI
  - lifecycle E2E article edit flow
  - temp-draft and permanent post edit parity

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
