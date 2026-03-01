# Tooty Carousels Product Boundary

This document defines the approved product boundary for the `Tooty Carousels` plugin.

The goal is to make `Tooty Carousels` a flagship free plugin that clearly demonstrates the power of the Tooty extension model without collapsing the premium roadmap.

## Product Role

`Tooty Carousels` is a free, community plugin.

It should be:

- genuinely useful on its own
- polished enough to prove the CMS can support serious plugins
- theme-aware and reusable
- intentionally limited so premium extensions still have clear headroom

It should not be treated as a throwaway homepage helper.

## Free Tier Scope (Approved)

The free plugin includes:

- multiple carousel sets
- slides within sets
- reusable embed handles
- inline slide editing
- basic workflow
- theme-query-first rendering
- basic media selection from the media library

### Content Model

Approved model:

- `carousel` = a set
- `carousel-slide` = a child content type

Set-level expectations:

- stable key/slug for reusable placement
- title / description
- workflow state
- optional placement key

Slide-level expectations:

- belongs to a set
- title / description
- image
- CTA
- ordering
- workflow state

### Reusable Embed Contract

Reusable handles are exposed by:

- internal ID
- public key/slug

The public key/slug is the primary reusable handle.

Themes should render carousels by querying for a specific key/slug, not by hardcoding a single implicit global carousel.

### Workflow

The free plugin workflow is intentionally simple:

- `draft`
- `published`
- `archived`

Scheduling is explicitly out of scope for the free plugin.

### Theme Integration

The rendering contract is query-first.

Themes should consume carousel data through normal theme queries, not by directly invoking plugin runtime code.

Helper tags can be added later, but they are not part of the approved initial scope.

### Placement Model

Placements are theme-driven.

That means:

- the plugin provides stable keys/slugs
- themes decide which key/slug to render and where
- no hardcoded CMS placement registry is required for the first release

### Admin Navigation

Because the plugin is intended to become a reusable content workspace, its target menu placement is:

- `menuPlacement: "both"`

This gives:

- a root workspace for day-to-day carousel management
- a settings surface under `Settings > Plugins`

### Asset Scope

The free plugin includes basic media-library-backed selection.

This should mean:

- authors can select an existing media item instead of typing a URL by hand
- the plugin may still persist a concrete resolved image URL for theme rendering

Advanced asset workflows remain outside the free boundary.

## Premium Boundary (Approved)

These capabilities are intentionally reserved for premium plugins or premium extensions later:

- analytics
- scheduling windows / campaign timing
- advanced asset variants (for example: desktop/mobile variants, richer rendition systems)
- targeting / personalization
- approvals / collaboration workflows

These are not part of the free `Tooty Carousels` contract.

## Implementation Rules

1. Core remains generic.
   - No Robert-specific assumptions.
   - No site-specific placement names in core.

2. Themes own presentation.
   - Themes query and render carousel data.
   - Themes should not own workflow or data writes.

3. Plugin owns carousel management.
   - The plugin owns set/slide admin UX.
   - The plugin owns ordering and workflow controls.

4. Query-first over helper-first.
   - The initial implementation should prefer theme queries and DTO-shaped data.

5. Premium line must remain obvious.
   - Do not silently add premium-tier concerns into the free plugin.

## Current Approved Next Step

The next implementation phase should:

- evolve the plugin from a single-carousel manager into a multi-carousel workspace
- introduce the `carousel` / `carousel-slide` model
- keep the free scope within the boundary above
- update themes to query a named carousel instead of assuming a single implicit slider
