# Data Domains (Post Types)

Data Domains are Tooty's post-type model for non-default content groups.

UI label:

- Site settings tab: `Post-Types`

Core default:

- `post` is treated as a built-in default post type.

## Purpose

1. Support multiple content types per site.
2. Keep domain content separated and activation-controlled.
3. Keep storage site-scoped with shared core content tables, not per-domain physical tables.

## Core tables

- `tooty_data_domains`
  - domain registry contract (canonical id + defaults; no extension-owned physical table authority)
- `tooty_site_data_domains`
  - site/domain assignment + `isActive`
- `tooty_domain_posts`
  - normalized domain content rows
- `tooty_domain_post_meta`
  - extra field storage for domain posts
- `tooty_term_taxonomy_domains`
  - taxonomy/domain linkage

## Storage contract (MUST)

Data Domains must use shared normalized storage:

- `<prefix>domain_posts`
- `<prefix>domain_post_meta`

Per-domain physical tables are forbidden for Data Domains.
Plugins and setup routines must not create `<prefix>domain_<slug>` or `<prefix>domain_<slug>_meta` tables.

## Activation model

Domain existence and site activation are separate:

1. Register domain contract entry
2. Assign/activate per site

`Post-Types` settings page supports:

- create
- activate/deactivate
- update label
- toggle menu visibility (`showInMenu`)
- delete
- usage count display

Menu visibility contract:

- `settings.showInMenu !== false` means the data domain is public in the admin content nav.
- `settings.showInMenu === false` means the data domain remains usable/assigned, but is hidden from the left-hand content menu.
- This does not deactivate the domain or remove its routes; it only controls admin menu presentation.

## Taxonomy relation

Taxonomies are independent entities.
They can be linked to domains via `term_taxonomy_domains`.

Default taxonomy remains:

- `category`

Tags remain open vocabulary through the term taxonomy model.

## Editor relation

Current editor taxonomy UX focuses on terms/categories/tags.
Domain-specific editors and forms are the next layer and can be plugin/theme-driven.

## API and internal integration

Current HTTP routes:

- `GET/POST /api/data-domains`
- `POST /api/data-domains/activate`
- `GET /api/data-domains/menu`

Internal extension API (`register(kernel, api)`) also exposes:

- `listDataDomains(siteId?)`

This allows plugins/themes to consume domain state without relying on REST routes.
