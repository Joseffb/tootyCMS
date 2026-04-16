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

### 22. Core RSS feed system in reading settings

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/feed.xml/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/[domain]/layout.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/settings/reading/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/site/[id]/settings/reading/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/cms-config.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/actions.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/admin-nav.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/core-version.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/package.json`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/VERSIONING.md`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - add a WordPress-style core RSS feed at `/feed.xml`
  - manage network defaults and site overrides from the existing reading settings surfaces
  - support site-level enablement, excerpt/full payload mode, item-count limit, and included data-domain selection
  - advertise the feed through public autodiscovery metadata while keeping the route cache-first
- Affected surfaces:
  - public site feed delivery
  - public site metadata/autodiscovery
  - network reading settings
  - site reading settings
  - public cache invalidation for feed updates
- Required validation:
  1. `npm run test`
  2. `npm run test:integration`
- Current notes:
  - implemented from isolated git worktree `/Users/joseffbetancourt/PhpstormProjects/.codex-worktrees/tooty-cms-rss-reading` on branch `codex/rss-reading-settings`
  - validated on the final `0.4.14` tree with `npm run test` and `npm run test:integration`
  - product decisions locked for v1: canonical `/feed.xml`, reading-settings ownership, combined multi-domain site feed, configurable item count, and no extra feed-index/manifest route beyond autodiscovery plus feed self-linking

### 15. Robert Betan deploy repo self-contained plugin/theme bundle

- Status: `in_progress`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/robert_betan_vercel_deploy`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - make the Robert Betan deploy worktree carry the full community and custom plugin/theme bundle directly
  - remove one-off hardcoding so deploy assembly picks up every valid plugin/theme from the source repos automatically
  - keep Vercel preview deploys independent from GitHub-backed plugin installer fetches
- Affected surfaces:
  - Robert Betan deploy packaging
  - plugin/theme availability on Vercel preview
  - future Robert Betan deploy reproducibility
- Required validation:
  1. update the deploy sync script to vendor all valid community/custom plugin and theme directories
  2. run the sync script successfully
  3. confirm deploy-local `plugins/` and `themes/` include the expected community/custom assets
  4. redeploy preview and verify the admin sees the bundled plugin/theme set
- Current notes:
  - user requested that the deploy repo itself contain the plugins instead of relying on GitHub install flows
  - current deploy preview already bundles `tooty-story-teller`, `robert-betan`, and `robert-betan-sub`
  - community plugin repo inventory includes analytics/auth/comments/carousels/GDPR/dev-tools/export-import/sendmail plus `hello-teety`

### 14. Robert Betan dedicated Vercel deploy worktree scaffold

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/robert_betan_vercel_deploy`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - create a dedicated assembled deployment checkout for the Robert Betan site
  - keep `tooty-cms` as the CMS code of record while making the deploy checkout self-contained for Vercel
  - ensure the deploy checkout stays attached to Robert Betan Git history instead of becoming a separate orphan repo
  - add a repeatable sync script that pulls core app code plus Robert Betan themes/plugins into one place
- Affected surfaces:
  - Robert Betan deploy assembly workflow
  - future Vercel deploys for the Robert Betan site
- Required validation:
  1. create `robert_betan_vercel_deploy` as an RB git worktree
  2. run the sync script successfully
  3. confirm repo-local `themes/` and `plugins/` include the Robert Betan overlays
- Current notes:
  - created `/Users/joseffbetancourt/PhpstormProjects/robert_betan_vercel_deploy`
  - added deploy-local `.env.example`, `.gitignore`, and `scripts/sync-from-sources.sh`
  - converted the folder into a `git worktree` attached to `/Users/joseffbetancourt/PhpstormProjects/robert_betan` on branch `codex/rb-vercel-deploy`
  - corrected the sync script so it preserves worktree git metadata instead of deleting `.git`
  - verified the first sync completed successfully into the RB-attached deploy worktree
  - verified repo-local `themes/` contains `robert-betan` and `robert-betan-sub`
  - verified repo-local `plugins/` contains `tooty-story-teller`

### 13. Robert Betan local universe content fill and Story Teller demo seeding

- Status: `verified`
- Area:
  - local Robert Betan runtime content in the `robertbetan_` prefixed development database
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/fetchers.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/next.config.js`
  - `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-custom-themes/robert-betan-sub/templates/single.html`
- Scope:
  - populate the local Robert Betan subsites with first-pass universe copy, character/profile-style entries, and hub content
  - keep `main` positioned as the orchestration site
  - make `axed` the first concrete Story Teller demo surface so the plugin can be reviewed on a real entry
- Affected surfaces:
  - `main.robertbetan.test`
  - `axed.robertbetan.test`
  - `cigars.robertbetan.test`
  - `lexia.robertbetan.test`
  - `car.robertbetan.test`
  - `shorts.robertbetan.test`
  - `audio.robertbetan.test`
  - `writing.robertbetan.test`
- Required validation:
  1. local DB inventory before/after seeding
  2. browser verification of the seeded public pages
  3. browser verification that the Story Teller demo renders on `axed`
- Current notes:
  - seeded first-pass local content across `main`, `axed`, `cigars`, `lexia`, `car`, `shorts`, `audio`, and `writing`
  - kept `main` as the orchestration hub and seeded `axed` with a page-based Story Teller demo surface
  - fixed a local Robert Betan theme regression where `robert-betan-sub/templates/single.html` used a Nunjucks include pattern that broke server-side detail rendering
  - fixed core local multi-site dev host allowance so branded `*.robertbetan.test` origins are accepted by Next dev
  - fixed core domain-detail loading so non-`post` entries expose meta rows to runtime plugins; this was required for page-based Story Teller payloads to render
  - verified by local DB inventory, local HTTP/browser checks for `main`, `axed`, and `cigars`, and direct HTML/runtime inspection showing Story Teller gutter/action/runtime markup plus seeded artifact payload on `axed`

### 12. Global `AGENTS.md` base policy with project overlays

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/AGENTS.md`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - replace a project-blended execution constitution with a reusable global `AGENTS.md`
  - isolate project-specific rules into explicit overlay sections instead of mixing them into the base policy
  - make delegation guidance capability-aware so the file remains portable across Codex environments
- Affected surfaces:
  - repo-level Codex execution guidance
  - future multi-project agent policy reuse
  - project-boundary and validation expectations for Tooty/Fernain and Lyra overlays
- Current notes:
  - user requested a global design review rather than a Tooty-only policy file
  - drafting a base-plus-overlays structure so repo-specific roots, workflows, and validation gates stay scoped to named projects
  - created a root `AGENTS.md` that separates global execution policy from named project overlays
  - delegation guidance is now capability-aware so the file remains portable even when subagent tooling is unavailable
  - docs-only validation completed with manual consistency review and `git diff --check`

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

### 15. Render policy contract, baseline audit, and first public-route cache correction

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/[domain]/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/RENDER_POLICY.md`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/RENDER_POLICY_AUDIT_2026-04-07.md`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - codify an explicit render-policy contract for public/admin/API surfaces
  - re-run the public-route rendering audit against the new contract with file/line evidence
  - convert the top-level public entry routes (`/` and `/[domain]`) from unconditional dynamic rendering to ISR with dev-only no-store behavior
- Affected surfaces:
  - rendering governance docs
  - public-route cache/dynamic audit baseline
  - root site public homepage rendering
  - domain homepage rendering
- Required validation:
  1. `npm run test`
  2. `npm run test:integration`
- Current notes:
  - added `docs/RENDER_POLICY.md` as the authoritative contract for surface-level render behavior
  - recorded a baseline audit in `docs/RENDER_POLICY_AUDIT_2026-04-07.md`
  - converted `app/page.tsx` and `app/[domain]/page.tsx` from `dynamic = "force-dynamic"` to `revalidate = 60`
  - added development-only `unstable_noStore()` in the two public entry routes so local development stays request-fresh without forcing dynamic rendering in production
  - `npm run test` is green on the current tree
  - `next build` within `npm run test` still classifies `/` and `/[domain]` as dynamic (`ƒ`) routes
  - `npm run test:integration` is green and its build classifies `/` as dynamic (`ƒ`) and `/[domain]` as SSG (`●`)
  - executed render classification is still environment-sensitive, so the cache-first contract is not yet satisfied deterministically
  - current remaining explicit public-route violation is `app/sitemap.xml/route.tsx`
  - this slice is verified as a first correction and audit update, with follow-up render determinism work still remaining

### 16. Vercel preview build failure against prod DB in network settings bootstrap

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/settings-store.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/settings-store.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - unblock Vercel preview deploys that run against the production Robert Betan database
  - make network system-settings bootstrap idempotent under concurrent/prerendered reads
- Affected surfaces:
  - production/preview build-time settings reads
  - `/robots.txt` prerender path
  - shared network settings bootstrap behavior
- Required validation:
  1. `npx vitest run tests/settings-store.test.ts`
  2. `npm run test`
  3. `npm run test:integration`
  4. `vercel deploy -y`
- Current notes:
  - preview deploy failed while prerendering `/robots.txt` against the prod DB with duplicate key constraint `pg_type_typname_nsp_index` for `robertbetan_network_system_settings`
  - root cause is the network settings bootstrap path doing raw `CREATE TABLE IF NOT EXISTS` without the duplicate-pg-type guard and advisory lock discipline already used by the site-scoped settings bootstrap
  - fixed by serializing network settings bootstrap with an advisory transaction lock and swallowing duplicate pg_type races during DDL
  - added a focused regression test covering the duplicate-pg-type race during `getSettingByKey()`
  - `npx vitest run tests/settings-store.test.ts`, local `npm run build`, `npm run test`, and `npm run test:integration` are green on the current tree
  - Vercel preview redeploy succeeded against the new `robertbetan_prod` database using deploy-time DB overrides: `https://robertbetan-i9llz0ncd-joseffbs-projects.vercel.app`
  - validated with the current setup-env slice in the same tree; preview update for the combined checkpoint remains the next step

### 17. Serverless setup env persistence must not write runtime files or self-mutate envs when config already exists

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/setup-env.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/api/setup/env/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/setup-env-route.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/SETUP_AND_RUNTIME_UPDATES.md`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/README.md`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - stop setup from trying to write `.env` files in serverless runtimes
  - make setup smart enough to use already-populated runtime env vars instead of attempting persistence
  - keep local development `.env` persistence behavior intact
- Affected surfaces:
  - setup wizard env-save behavior
  - Vercel and other serverless runtime setup flows
  - setup documentation and operator expectations
- Required validation:
  1. `npx vitest run tests/setup-env-route.test.ts`
  2. `npm run test`
  3. `npm run test:integration`
- Current notes:
  - setup helper now short-circuits to runtime-backed config when managed/serverless env vars already satisfy setup, even if a persistence backend is configured
  - setup route and UI copy now describe configuration truthfully instead of always claiming environment values were saved
  - updated contract is: on Vercel, setup first uses already-populated runtime env values and otherwise falls back to the Vercel env API; on other managed runtimes it consumes runtime env values without attempting file writes
  - local `.env` persistence remains local-only
  - `npx vitest run tests/setup-env.test.ts` and `npx vitest run tests/setup-env-route.test.ts` are green
  - `npm run test` is green
  - `npm run test:integration` is green after rerunning sequentially; the earlier Firefox failure was caused by parallel gate contention, not by this setup-env change
  - follow-up preview debugging on 2026-04-08 found `/api/setup/env` timing out on Vercel after 10 seconds during setup
  - fixed by giving the setup route a larger Vercel function budget and reducing Vercel env sync from per-field list/delete/create cycles to a single env listing plus populated-key upserts only

### 18. First-run setup must auto-apply schema on serverless runtimes without manual Drizzle commands

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/api/setup/env/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/db-health.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/setup/setup-wizard.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/setup-env-route.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/setup-wizard.test.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/SETUP_AND_RUNTIME_UPDATES.md`
- Scope:
  - remove the first-run setup dependency on manual `drizzle-kit push` for Vercel/serverless users
  - make setup bootstrap the required schema over the configured Postgres connection automatically
  - update operator-facing setup messaging so the framework does not instruct hosted users to run CLI schema commands
- Affected surfaces:
  - setup schema bootstrap on managed runtimes
  - setup wizard user messaging
  - first-run Vercel/Neon onboarding
- Required validation:
  1. `npx vitest run tests/setup-env-route.test.ts tests/setup-wizard.test.tsx`
  2. `npm run test`
  3. `npm run test:integration`
- Current notes:
  - current setup route already attempts automatic schema bootstrap, but the failure contract still falls back to telling hosted users to run `npx drizzle-kit push`
  - manual recovery on 2026-04-08 succeeded by pushing the schema against `robertbetan_prod`, which confirms the first-run framework path still needs hardening for managed/serverless setups
  - implementation now uses a direct Postgres bootstrap path for first-run network tables and lazily loads `next-auth/react` inside the setup auto-sign-in path so `/setup` does not hard-fail before auth env is configured
  - `npx vitest run tests/setup-env-route.test.ts tests/setup-wizard.test.tsx` is green
  - `npm run test` is green
  - `npm run test:integration` is green
  - the dedicated setup flow integration spec (`tests/e2e/setup-flow.spec.ts`) passed inside the full integration run
  - active fix landed by moving setup schema/bootstrap work onto the submitted runtime env values and submitted table prefix during the setup request so automatic init does not silently target stale process env
  - preview deployment completed on 2026-04-08 at `https://robertbetan-dgokf8dym-joseffbs-projects.vercel.app`

### 19. Security hardening from April 8 audit triage

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/auth.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/actions.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/api/auth/native/password-reset/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/plugin-routes.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/media-service.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/api/media/[id]/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/db-health.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/plugin-routes.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/media-item-route.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/auth-session.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/media-upload-file-route.test.ts`
- Scope:
  - cryptographically bind mimic-session cookies so session swapping is not driven by unsigned cookie state
  - replace weak password-reset code generation and tighten practical reset throttling
  - filter sensitive request headers before governed plugin handlers receive route context
  - remove cross-tenant media lookup by requiring site-scoped media record resolution
  - parameterize or otherwise eliminate constant interpolation in raw SQL maintenance paths
  - harden the generic media upload route using the stricter image/file validation patterns already present elsewhere in core
- Affected surfaces:
  - network-admin mimic flow
  - native password reset
  - governed plugin route execution
  - media item edit/delete APIs
  - DB maintenance/bootstrap safety
  - hosted preview security posture
- Required validation:
  1. targeted Vitest coverage for auth/plugin/media/security paths
  2. `npm run test`
  3. `npm run test:integration`
  4. `vercel deploy -y`
- Current notes:
  - this slice is based on the locally reviewed, high-confidence findings from the April 8 audit rather than treating the full report as authoritative
  - implementation is being kept contract-safe: core-owned auth/session/media boundaries remain core-owned, and plugin execution is being tightened without changing the published kernel/plugin contract shape
  - mimic-session cookies are now cryptographically bound before any admin-to-user session swap is honored
  - password reset codes now use `crypto.randomInt(...)`, and the route adds lightweight per-IP throttling on request and apply paths
  - governed plugin route handlers now receive a filtered header set with sensitive and platform-specific forwarding headers removed
  - media item lookup is now site-scoped, which closes the cross-tenant ID scan path and aligns update/delete flows with tenant boundaries
  - raw SQL maintenance paths in `lib/db-health.ts` now quote literals or use SQL parameter binding instead of interpolating constant values directly into statements
  - the generic media upload route now validates MIME/extension combinations and rejects blocked or disguised executable/script payloads
  - targeted Vitest coverage is green for auth/plugin/media/security and setup/serverless paths
  - `npm run test` is green
  - `npm run test:integration` is green
  - `vercel deploy -y` completed on 2026-04-08 at `https://robertbetan-dgokf8dym-joseffbs-projects.vercel.app`

### 20. Hosted setup wizard must not hydrate configured secrets into the client

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/setup-env.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/setup/page.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/setup/setup-wizard.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/api/setup/env/route.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/setup-env.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/setup-env-route.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/setup-wizard.test.tsx`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/e2e/site-lifecycle.spec.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - stop hosted `/setup` from serializing configured secrets or unrelated env keys into the client payload
  - preserve already-configured password values server-side when operators leave hosted password fields blank
  - keep required non-password fields truthy when operators clear them instead of letting the wizard bypass validation
  - harden the WebKit lifecycle wait that flaked under full-suite load after the setup fix verification pass
- Affected surfaces:
  - hosted setup wizard initial state
  - Vercel/serverless first-run operator experience
  - setup env save normalization
  - cross-browser site lifecycle integration stability
- Required validation:
  1. `npm run test`
  2. `npm run test:integration`
- Current notes:
  - preview verification on 2026-04-08 showed `/setup` rendering successfully on Vercel, but the page payload still exposed configured setup secrets to the browser through the initial wizard seed
  - `loadSetupEnvValues()` is now allowlist-only for setup fields, and `buildSetupWizardSeed()` blanks password values before hydration while only exposing configured-password metadata needed to preserve hosted secrets
  - the setup route now preserves existing configured password values when the client leaves those fields blank, while required non-password fields must remain populated and can no longer bypass client validation if cleared
  - a parallel review found the first seed-model pass still let cleared non-password fields slip through and leaked the presence of every configured secret key; both issues are now fixed on the current tree
  - the WebKit `site lifecycle` suite exposed a one-off timeout waiting for the final `Unpublish` button under full-suite load; an isolated rerun passed, and the suite now keeps the same assertion with a longer wait budget on that specific transition
  - `npm run test` is green
  - `npm run test:integration` is green

### 21. Vercel preview auth cookies must not pin to the production root domain

- Status: `verified`
- Area:
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/lib/auth.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/tests/auth-cookie-domain.test.ts`
  - `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`
- Scope:
  - keep production subdomain-sharing cookies on the branded root domain
  - make Vercel preview deployments fail closed to host-only auth cookies instead of forcing `.NEXT_PUBLIC_ROOT_DOMAIN`
  - verify preview native login sets a session again after the cookie-domain correction
- Affected surfaces:
  - Vercel preview login/session persistence
  - production auth cookie domain behavior
  - native credentials login on hosted previews
- Required validation:
  1. `npm run test`
  2. `npm run test:integration`
  3. `vercel deploy -y`
- Current notes:
  - live preview auth accepted native credentials but did not retain a session cookie
  - `NEXTAUTH_URL` and `NEXT_PUBLIC_ROOT_DOMAIN` are set to `robertbetan.com` in preview, while the actual preview host is `*.vercel.app`
  - the existing Vercel auth cookie config always forced `Domain=.NEXT_PUBLIC_ROOT_DOMAIN`, which prevents the browser from storing the cookie on preview hosts
  - preview deployments now fail closed to host-only cookies unless `VERCEL_ENV=production` and `NEXTAUTH_URL` matches the configured branded root domain
  - production still retains branded root-domain cookie sharing when the auth host matches the configured root
  - focused auth cookie-domain coverage is green
  - `npm run test` is green
  - `npm run test:integration` is green
