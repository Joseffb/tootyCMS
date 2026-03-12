# Plugin Admin UX

This document defines the emerging default UI language for plugin admin surfaces in Tooty.

It is not a visual design system. It is a behavior and structure contract for plugin administration so plugin workspaces feel coherent across the platform.

## Purpose

Plugin admin UIs should feel:

- structured
- fast
- low-friction
- operationally clear
- consistent with the existing Tooty admin shell

The goal is not maximum novelty. The goal is reducing cognitive load while preserving power.

This document intentionally combines:

- Tooty's emerging operator-first UI taste
- broader UX and UI best practices

That matters because consistent taste is useful, but taste alone is not a sufficient design system.

When platform taste and UX best practice conflict:

- preserve safety
- preserve clarity
- preserve accessibility
- preserve task completion

Do not keep a pattern just because it "feels right" if it increases user error, hides state, or harms accessibility.

## Acceptance Rule

This is not optional guidance for contributed extensions.

Community and premium themes/plugins submitted for Tooty should be treated as failing review if they do not meet the baseline UX and accessibility expectations in this document.

Minimum acceptance standard:

- keyboard reachable interaction
- explicit labels for interactive controls
- visible state and mutation feedback
- no color-only meaning
- safe destructive flows
- one clear primary interaction per surface

If a contribution violates these baseline rules:

- it should be revised before acceptance
- CI validation should fail where an enforceable baseline check exists
- maintainers should not waive the issue just because the feature works

## Core Pattern

Use the same mental model across plugin workspaces:

- top-level tabs for major responsibilities only
- table/list rows for existing records
- action buttons to reveal create flows
- inline editing where safe
- auto-save for edits
- modal editors for deeper record editing

Avoid dumping multiple unrelated forms and lists on one long page.

## Best-Practice Guardrails

These are the non-negotiable UX checks that should temper the default Tooty admin style.

### A. Clarity Beats Cleverness

Interfaces should be obvious on first use.

Use:

- explicit labels
- visible state
- predictable action placement

Avoid:

- hidden interactions that require discovery
- ambiguous icon-only controls without clear affordance
- overloaded areas where users cannot tell what clicks do

Compact is good. Ambiguous is not.

### B. Accessibility Is Part of the Contract

All plugin admin UIs should remain operable for users who rely on:

- keyboard navigation
- screen readers
- high contrast
- reduced precision input

At minimum:

- interactive elements need real labels
- icon buttons need `aria-label`
- modal focus should remain understandable
- clickable rows must still have explicit focusable targets
- color cannot be the only signal for enabled/disabled state
- button elements must declare explicit `type`
- image elements must include meaningful `alt` text, or explicit empty `alt=""` when decorative
- focus indicators must remain visible
- autosave success and failure states must be announced in readable text, not color alone

The "enabled light" pattern is good, but it must always be paired with readable text.

Accessibility is a first-class product requirement in Tooty, not a later enhancement pass.

### C. Progressive Disclosure, Not Hidden Capability

It is correct to hide complexity until needed.

It is not correct to hide capability so deeply that users cannot find it.

Use:

- tabs
- modals
- expandable danger zones
- add buttons that reveal create flows

But ensure:

- the entry point is visible
- labels are plain
- the next step is obvious

### D. Fast Paths Must Still Be Safe

Auto-save is a strong Tooty default for existing records, but it must be used carefully.

Good auto-save cases:

- text edits with low destructive risk
- toggles
- ordering
- local plugin settings

Use caution or require explicit save when:

- edits are expensive or multi-step
- changes trigger irreversible side effects
- multiple fields must remain valid together
- partial intermediate values would create broken state

Auto-save should reduce friction, not create accidental writes.

Because Tooty favors auto-save heavily, every auto-saving surface should also provide:

- obvious saving/saved/error status
- stable focus after mutation
- no hidden destructive side effects
- a clear escape hatch for create flows before a record exists

### E. Dense Interfaces Still Need Scan Hierarchy

Operational density is valuable, but dense UIs still need visual hierarchy.

Use:

- strong section titles
- grouped controls
- whitespace between responsibilities
- consistent label styling

Dense should mean efficient, not crowded.

### F. One Interaction Per Surface

Each UI region should communicate one dominant behavior.

Examples:

- a drag handle means reorder
- a row means open
- a modal means edit deeply
- a danger bar means destructive action

Avoid mixing conflicting behaviors into the same area unless the affordances are clearly separated.

This is especially important for clickable rows.

### G. Minimize Duplicate Representations

Do not show the same entity in multiple editing surfaces on the same screen unless there is a strong reason.

Example of what to avoid:

- sortable list
- plus separate editable table for the same records

That creates uncertainty about which surface is authoritative.

The preferred rule is:

- one primary representation per task

### H. Feedback Must Be Immediate and Legible

If the UI auto-saves or mutates state quickly, the user needs immediate feedback.

Use:

- simple save state text
- disabled/loading state during mutation
- obvious success/failure wording

Do not rely on silence alone for actions that may fail.

For accessibility and operator confidence:

- errors must be readable in text
- pending states must be distinguishable from idle states
- users should never need to infer save failure from stale data alone

### I. Destructive Actions Need Friction

Delete should not be casual.

Even in a low-friction system:

- destructive actions need visual isolation
- users need a deliberate confirmation step
- typed confirmation should remain where policy requires it

Fast UI does not mean reckless UI.

### J. Consistency Beats Reinvention

When a pattern already exists and works:

- reuse it
- refine it
- document it

Do not invent a new interaction style for each plugin unless the domain truly requires it.

This is how Tooty becomes coherent instead of becoming a pile of individually "clever" screens.

### K. Do Not Expose Raw JSON As A Primary Admin Input

Admin users should not be asked to hand-edit JSON for normal product workflows.

Default rule:

- do not add raw JSON textareas or generic JSON object fields to admin apps
- do not treat "paste JSON here" as an acceptable primary configuration UX

Prefer structured controls instead:

- dropdowns
- searchable comboboxes
- creatable select inputs
- toggles
- segmented buttons
- radio groups
- repeatable field rows
- keyed list editors
- modal pickers
- sortable lists

If users need to add values dynamically, use UI patterns such as:

- creatable dropdowns
- add-row repeaters
- key/value editors with explicit labeled fields

Not:

- an unbounded JSON blob field

Why:

- JSON fields shift validation and correctness burden onto the operator
- they hide schema expectations
- they increase copy/paste mistakes
- they are harder to review, harder to diff mentally, and harder to make accessible

Exception rule:

- a raw JSON field is only acceptable for explicitly advanced/debug/import use cases
- it must be clearly labeled as advanced
- it must not be the only way to perform a normal admin task
- the structured UI remains the primary workflow

## Layout Rules

### 1. Use Logical Tabs

Top tabs should represent major domains of responsibility, not every nested view.

Good:

- `Carousels`
- `Settings`

Bad:

- tabs for every sub-entity if those sub-entities are better treated as detail views

### 2. Prefer Tables and Structured Rows for Existing Records

Existing records should usually be shown in:

- tables
- dense lists
- clearly segmented rows

This is the preferred presentation for operational review and maintenance.

Use cards only when the data is inherently visual or does not fit tabular scanning.

### 3. Create Flows Should Be Focused and Temporary

Creation is the exception to Tooty's normal inline-edit pattern.

Preferred create surfaces:

- modal create forms
- reveal-on-click inline create panels

Avoid leaving large create forms permanently open above management lists.

### 4. Existing Records Should Edit in Place or in a Focused Editor

For existing records:

- simple fields should inline edit and auto-save
- deeper records should open in a modal editor

Avoid scattering the same record's editable fields across multiple separate surfaces.

### 5. Click Targets Must Be Obvious

If a row opens a detail view:

- the clickable zone should be visually consistent
- action icons should remain visibly separate
- drag handles should be the only drag affordance

Do not make users guess whether text, whitespace, icons, and controls do different things.

### 6. Accessibility Must Survive Density

Dense admin UI is acceptable only if:

- controls remain reachable by keyboard
- hit targets stay usable
- focus order makes sense
- inline editing does not trap users
- modal flows remain navigable

Efficiency is not permission to degrade accessibility.

If a child collection belongs to a parent record, the child collection should usually open from the parent detail view, not become a top-level tab.

### 2. Treat Child Collections as Detail Views

When a plugin manages parent/child content:

- the parent list is the primary workspace
- clicking a parent opens the child detail view
- child records should be managed inside that detail view

Example:

- carousel set list
- click a set
- manage slides in that set

### 3. Prefer Wide Context Selectors

When site context is required:

- use a wide selector
- changing it should immediately reload the correct workspace state
- avoid extra “Open” or “Apply” buttons when selection can safely auto-submit

This should feel like a context switch, not a form submission workflow.

## Record Listing Rules

### 4. Existing Records Belong in Tables or Structured Rows

Use table rows or row-like list items for existing records.

Do not default to stacked edit cards for record lists.

Reasons:

- easier scanning
- easier comparison
- better operational density
- matches existing plugin/theme settings surfaces

### 5. Make Primary Rows Clickable

If a row’s primary purpose is “open this record”, the row should behave like an open target.

Typical pattern:

- title cell clickable
- key/placement cell clickable
- count/status context cells clickable when they are part of the open action
- explicit action buttons remain excluded from the click target

This reduces hunting for the one linked label.

Guardrail:

- clickable rows still need clear sub-action separation
- the row should not swallow edit, delete, drag, or toggle controls
- if too many exceptions appear, the row is overloaded and should be redesigned

### 6. Action Buttons Should Be Sparse and Iconic

When the row itself opens the record:

- use icon actions for secondary row actions
- default icons:
  - pen = edit
  - trash = delete

Text buttons are acceptable when an action is not a common row-level affordance, but for standard edit/delete they should stay compact.

## Create Flow Rules

### 7. “Add” Starts Hidden

Create forms should not be permanently open by default.

Use:

- `Add …` button
- reveal a modal or dedicated create pane only when clicked

This keeps operational pages focused on existing content first.

### 8. Create Is the Main Exception to Auto-Save

Create flows are the one place where an explicit save button is expected.

Rules:

- new entities may use a `Save` button
- editing existing entities should not require one
- do not mix create-style save flows into existing-record editing surfaces unless there is a real transactional need

## Editing Rules

### 9. Existing Records Should Prefer Auto-Save

For existing entities:

- inline changes should auto-save
- toggles should auto-save
- sorting should auto-save
- modal edits should auto-save on field blur/change

Avoid forcing users into repeated “edit, save, reload” loops.

Guardrail:

- auto-save is the default, not an absolute rule
- if the editing surface becomes validation-heavy or multi-step, explicit save may be more humane

### 10. Inline Editing Should Feel Like Editing Content, Not Filling Forms

For existing records, prefer:

- contenteditable or direct inline field treatment
- simple focused inputs only where precision matters

Examples where classic input controls still make sense:

- numeric order fields
- controlled selects
- file/media selectors

But avoid turning every edit view into a long traditional form if the content can be edited more directly.

Guardrail:

- inline editing still needs clear focus styling
- contenteditable should not be used where structured validation or accessibility would suffer
- use proper inputs when they communicate the control more clearly

### 11. Use Modal Editors for Deep Record Editing

When a row needs deeper editing:

- clicking the record opens a modal editor
- the modal should feel like an editor, not a settings dump

That means:

- title prominent at top
- primary status controls near top
- content grouped visually
- destructive actions isolated at bottom

Modal quality rules:

- modal title should immediately identify what is being edited
- close action should be obvious
- the layout should support scanning, not mimic a cramped popup form
- treat the modal as a temporary workspace, not a dialog box stuffed with fields

## Toggle Rules

### 12. Enabled Toggles Use the Light Pattern

For binary on/off states, the preferred control is the Tooty toggle pill with status light.

Pattern:

- label text
- circular light indicator
- green/light glow when enabled
- neutral/dim when disabled

This is the preferred default for:

- enabled
- published
- active states

Use this instead of plain checkboxes when the action is a direct state toggle in admin.

## Sorting Rules

### 13. Drag Sorting Must Save Immediately

When a list supports drag ordering:

- the drag handle is the only drag target
- the rest of the row should remain usable for opening/editing
- order persists immediately after drop

Do not require a separate `Save Order` button for normal record ordering.

Guardrail:

- the drag handle should be the only drag affordance
- the rest of the row should remain usable for the row’s primary action

## Destructive Action Rules

### 14. Deletion Must Stay Explicit and Isolated

Delete flows must remain visually separate from normal edit actions.

Recommended pattern:

- row-level trash action to initiate delete intent
- then a dedicated delete state:
  - inline danger panel, or
  - modal danger zone
- typed confirmation remains required where destructive delete policy requires it

Do not make delete feel like a casual inline toggle.

## Settings Rules

### 15. Plugin Settings Should Usually Be Inline Tab Content

If a plugin has settings:

- they should usually live inside the plugin workspace as a `Settings` tab
- not a second disconnected page unless the settings surface is large enough to justify it

Settings fields should prefer the same auto-save pattern as other existing-record edits when the changes are safe and local.

Guardrail:

- settings should still read like configuration, not content editing
- if a settings surface becomes operationally complex, it may deserve its own workspace rather than a cramped tab

## Media Rules (Current Interim)

### 16. Reuse Existing Media Selection Patterns

Until the dedicated media spine lands:

- do not invent a new media selection interaction for each plugin
- reuse the closest existing media-manager interaction pattern available

This is an interim rule only.

Long-term, plugin and editor media flows should converge on a shared file-manager interface.

## What To Avoid

Avoid these default failure modes:

- one giant page with unrelated sections
- always-open create forms
- stacked edit cards for large collections
- save buttons on every edit action
- duplicate list + edit surfaces for the same entity on the same screen
- checkbox-heavy settings pages when a direct toggle affordance is clearer
- hidden primary actions that require pixel hunting

Also avoid:

- using modals for everything
- making every row clickable when the row has too many competing actions
- icon-only interfaces without text or labeling support
- auto-saving fields that users expect to compose before committing
- visually dense layouts with no hierarchy or breathing room

## Current Reference Surfaces

The current reference signals for this style come from:

- export/import plugin operational console
- network and site plugin settings tables
- network theme settings tables
- current carousel plugin workspace refactor

These are reference implementations, not immutable exact templates.

The contract is the behavior pattern and interaction language, not exact markup.

## Summary Principle

The Tooty admin style should feel like a fast operator console.

But the governing standard is:

- understandable
- accessible
- safe
- consistent
- efficient

If a UI is fast but confusing, it is not done.
If it is clean but slow and repetitive, it is not done.
The target is disciplined speed.
