# Tooty CMS Execution Constitution

Applies to:

- `/Users/joseffbetancourt/PhpstormProjects/tooty-cms`
- `/Users/joseffbetancourt/PhpstormProjects/Fernain Site`
- `/Users/joseffbetancourt/PhpstormProjects/robert_betan`
- related Tooty plugin/theme repos when explicitly in scope

Non-negotiable. Fail-closed. Optimize for correctness, contract integrity, and verified results.

## 1. Source of Truth

Default implementation repo:

- `/Users/joseffbetancourt/PhpstormProjects/tooty-cms`

Fernain and Robert Betan are downstream site repos, not alternate sources of truth for core behavior.

If work affects auth, routing, schema, admin behavior, rendering contracts, settings spine, export/import, tracing, or extension boundaries:

1. implement in `tooty-cms`
2. validate there first
3. sync downstream only when that flow is in scope

Never implement directly in Fernain unless explicitly instructed.

## 2. Approved Roots

Operate only within:

- `/Users/joseffbetancourt/PhpstormProjects/tooty-cms`
- `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-plugins`
- `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-themes`
- `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-premium-plugins`
- `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-premium-themes`
- `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-custom-plugins`
- `/Users/joseffbetancourt/PhpstormProjects/tootyCMS-custom-themes`
- `/Users/joseffbetancourt/PhpstormProjects/Fernain Site`
- `/Users/joseffbetancourt/PhpstormProjects/robert_betan`
- `~/.codex/`

If work would mutate outside those roots, stop and ask first.

## 3. Contract-First Rule

Before architectural change, review the live repo docs in `tooty-cms`:

- `docs/VERSIONING.md`
- `docs/SETUP_AND_RUNTIME_UPDATES.md`
- `docs/EXTENSION_CONTRACTS.md`
- `docs/PLUGIN_ADMIN_UX.md`
- `docs/THEME_SANDBOX_CONTRACT.md`
- `docs/KERNEL.md`
- `docs/LIFECYCLE_HOOKS.md`
- `docs/TRACING.md`

If code conflicts with those contracts:

1. flag the mismatch
2. explain the impact
3. wait for a decision
4. do not silently rewrite the contract

Use `references/contracts-index.md` only as a compact index, not as the authority over live docs.

## 4. Coordination Rule

Before substantial work, read and maintain:

- `/Users/joseffbetancourt/PhpstormProjects/tooty-cms/docs/DEV_TRACKER.md`

Required workflow:

1. check the tracker for overlapping open or in-progress work
2. claim your slice before editing:
   - scope
   - owning files or subsystems
   - affected surfaces
   - status
   - required validation
3. update it when blocked, expanded, handed off, or verified

Do not treat the tracker as optional documentation. It is the coordination spine across Tooty threads.

## 4A. Workspace Isolation Rule

For substantial implementation work, do not work directly in a shared checkout when
multiple agents or threads may be active.

Default safe flow:

1. create a dedicated temporary worktree folder outside the primary checkout
2. prefer `git worktree`; use a full clone only when worktree is not practical
3. create a fresh task branch in each touched repo before editing
4. if work spans `tooty-cms` plus a downstream/site repo, use matching task branch
   names across those repos
5. implement, test, commit, merge to `main`, and push from the isolated worktree(s)
6. delete the temporary worktree folder only after the change is landed

Never let two agents work in the same checkout on the same branch.

## 5. Core-First Workflow

If Fernain or Robert Betan is in scope, use this order:

1. implement in `tooty-cms`
2. run required validation in `tooty-cms`
3. pass all required gates
4. push `tooty-cms` only when explicitly requested
5. sync downstream with the approved sync command when that repo flow is in scope
6. validate downstream
7. push downstream only when explicitly requested

Never push red.

## 6. Core Governance

Core owns:

- auth
- routing
- schema
- writes
- extension contracts
- capability bridge
- lifecycle and hook dispatch

Core must not absorb plugin business logic, plugin routes, plugin UI, or plugin-specific files.

If a file exists only for one plugin, stop and either:

- move it into the plugin, or
- generalize it into a truly reusable platform primitive

Themes are presentation-only:

- may consume DTOs and render UI
- may not contain business logic
- may not contain auth logic
- may not directly access data or define routing

Plugins must not bypass:

- contracts
- auth
- routing
- direct DB boundaries

## 7. Exhaustive Engineering Mode

Optimize for:

- correctness over speed
- completeness over smallest diff
- system integrity over superficial green checks

Forbidden behaviors:

- fixing only the failing test
- modifying tests to pass broken logic
- hardcoded role checks
- inline DB access in UI
- contract bypass
- commenting out tests
- reducing strictness to pass
- claiming success without execution proof

Fix the class of bug, not just the instance.

## 8. Validation

Before any push to `tooty-cms`:

- `npm run test`
- `npm run test:integration`

Recommended for core-level changes:

- `npm run build`
- `npm run lint`

For non-trivial work, expand tests across:

- success path
- failure path
- unauthorized path
- tenant mismatch path
- invalid input path
- serialization boundary path
- negative path

If the same integration or E2E issue fails twice in a row:

1. stop broad reruns
2. audit the owning subsystem for root cause
3. fix the owning layer
4. add regression coverage before resuming the full gate

## 9. Schema and Migration Rule

For any schema, table, or column change, update migration health plumbing before closing:

- `lib/db-health.ts`
- `applyDatabaseCompatibilityFixes()`
- `tests/db-health-versioning.test.ts`

Any new tenant persistence must preserve the tenant storage split and be covered by tests.

## 10. Admin / UX Contract Rule

If work affects:

- admin scope
- sidebar composition
- settings navigation
- plugin admin UI
- theme settings UI

then you must:

1. audit both single-site and multi-site behavior
2. follow `docs/PLUGIN_ADMIN_UX.md`
3. treat accessibility as first-class acceptance criteria
4. update live repo docs when the scope contract changes
5. add explicit acceptance coverage for the correct mode-specific nav shape

## 11. Runtime Guardrails

- Node 22 baseline
- No localhost assumptions
- No single-domain assumptions
- Dev DB separate from prod DB
- No implicit seed assumptions
- No auto-recreate of deleted content

Destructive delete flows must include:

- two-step flow
- typed confirmation
- server-side enforcement

UI-only confirmation is insufficient.

## 12. Analytics Visibility Rule

Do not show analytics UI unless both are true:

- analytics plugin is enabled for the site
- provider has graph/query capability for that site

`site.analytics.read` alone is insufficient.

## 13. Private Site Workflow

When Tooty powers multiple private/branded sites:

- `tooty-cms` remains the only core application source of truth
- private site repos should contain site-specific assets and deploy metadata
- private site repos should not become parallel forks of core app code

Treat deployment assembly as an ops concern, not a runtime contract concern.

## 14. Playwright Harness Rule

For user-facing work that benefits from interactive browser qualification during implementation:

- `npm run playwright:harness:start`
- `npm run playwright:qualify -- <spec-or-args>`
- `npm run playwright:harness:status`
- `npm run playwright:harness:logs`
- `npm run playwright:harness:stop`

Rules:

- the harness is a coding aid, not release proof
- do not replace `npm run test:integration` with harness runs
- the full integration gate remains mandatory
- keep bootstrap non-interactive

## 15. Local Checkpoint Rule

After green validation, create a local checkpoint commit before starting the next substantial work chunk:

- local commit only unless the user explicitly asks to push
- use a conventional commit message
- a WIP checkpoint like `chore: checkpoint wip` is acceptable

This preserves a known-good recovery point between larger slices.

## 16. Reporting Contract

For non-trivial work, always report:

- files changed
- tests run
- test results
- coverage impact
- surface area impacted
- residual risk

Do not report guesses as facts.
Do not say "should work" when verification was not performed.
