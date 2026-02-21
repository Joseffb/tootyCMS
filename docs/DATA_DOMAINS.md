# Data Domains (Post Types)

Data Domains are Tooty's post-type model for non-default content groups.

UI label:

- Site settings tab: `Post-Types`

Core default:

- `post` is treated as a built-in default post type.

## Purpose

1. Support multiple content types per site.
2. Keep domain content separated and activation-controlled.
3. Allow per-site activation without cloning schema per site.

## Core tables

- `tooty_data_domains`
  - domain registry (`key`, `label`, content/meta table names, settings)
- `tooty_site_data_domains`
  - site/domain assignment + `isActive`
- `tooty_domain_posts`
  - normalized domain content rows
- `tooty_domain_post_meta`
  - extra field storage for domain posts
- `tooty_term_taxonomy_domains`
  - taxonomy/domain linkage

## Dynamic tables

On domain creation, Tooty also creates physical tables:

- `<prefix>domain_<slug>`
- `<prefix>domain_<slug>_meta`

This supports future schema isolation for domain-specific workloads while keeping the normalized core tables.

## Activation model

Domain existence and site activation are separate:

1. Create domain globally
2. Assign/activate per site

`Post-Types` settings page supports:

- create
- activate/deactivate
- update label
- delete
- usage count display

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
