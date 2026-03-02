# Media Spine System

The Media system is a governed spine service that provides a site-scoped media library backed by object storage and a database index.

Authoritative baseline:
- [Extension Contracts](./EXTENSION_CONTRACTS.md)
- [KERNEL](./KERNEL.md)
- [Theme Sandbox Contract](./THEME_SANDBOX_CONTRACT.md)
- [Setup And Runtime Updates](./SETUP_AND_RUNTIME_UPDATES.md)

## 1. Purpose

The Media Spine exists to:

1. Provide a tenant-scoped media library.
2. Abstract storage providers behind a stable contract.
3. Keep themes presentation-only.
4. Allow plugins to consume media without bypassing core authority.
5. Support retention, cleanup, and future quota enforcement.

Media is infrastructure, not a feature plugin.

## 2. Authority Model (MUST)

Core owns:

- upload routes
- storage provider selection
- DB index writes
- access enforcement
- cleanup execution
- media URL resolution

Plugins and themes:

- MUST NOT write directly to storage.
- MUST NOT write directly to `tooty_media`.
- MUST NOT bypass `/api/media` or governed upload routes.
- MUST consume media through canonical references.

Themes remain read-only consumers.

## 3. Storage Model

### Object Store (Provider-backed)

Objects are partitioned by site:

- `siteId/<filename>`

Provider types:

- `blob`
- `s3`
- `dbblob` (fallback/dev)

### DB Index Table

`tooty_media` tracks:

- `siteId`
- `userId`
- `provider`
- `bucket`
- `objectKey`
- `url`
- `label`
- `altText`
- `caption`
- `mimeType`
- `size`
- timestamps

The DB index is authoritative for CMS media state.

## 4. Upload Pipeline

Canonical flow:

1. Client calls the upload helper.
2. Core resolves the configured provider.
3. Core writes object data through the selected provider transport.
4. Core writes or updates the `tooty_media` index row.
5. Core emits trace records.

Provider override:

- `MEDIA_UPLOAD_PROVIDER=auto|blob|s3|dbblob`

Tracing must use the structured JSONL trace contract.

## 5. Access Control

`/api/media` and governed upload routes enforce:

- authenticated session for protected operations
- site ownership or elevated admin rights
- tenant boundary isolation

Media is strictly site-scoped.

Cross-tenant reads are invariant violations.

## 6. Spine Integration Pattern

Media follows the Spine Provider Pattern:

- Core owns semantics.
- Providers implement storage transport.
- No provider is auto-enabled without registration or configured selection.
- Disabling provider capability disables that media transport path.

Media is a core spine service, not a plugin-owned feature surface.

## 7. Editor + Plugin Integration

The editor and plugin UIs should support:

- upload new
- insert/select existing

Canonical admin surface:

- `media.manager`

Core ships the default `media.manager` implementation as a basic v1 file manager.

Surface rules:

- it opens in `pick` or `manage` mode
- it is site-scoped
- it uses only governed media spine routes
- it returns `mediaId`-first selections

Selection payload shape:

- `mediaId`
- `url` (preview-only)
- `mimeType`
- optional display metadata such as `label`, `altText`, `caption`, `width`, `height`

Plugins must:

- store media references (`mediaId` required for managed-library selections)
- resolve presentation URLs through the canonical media index
- avoid persisting raw external URLs when the media library is being used

Structured content should link media through metadata that resolves back to core-managed media records.

## 8. Cleanup + Retention

Canonical scheduler action:

- `core.media.cleanup`

Expected payload:

- `olderThanDays`
- `limit`
- `siteId`

Execution rules:

- must respect tenant boundary
- must be idempotent
- must log per-run audit traces

Cleanup is a core-governed maintenance operation.

## 9. Theme Boundary (Strict)

Themes may:

- render `url`
- render `label`
- render media metadata already provided by core

Themes must not:

- infer storage provider
- access storage buckets
- implement cleanup logic
- perform capability checks

All presentation decisions must derive from canonical theme context, not media internals.

## 10. Future-Ready Constraints

The Media Spine must support, without changing theme contracts:

- quotas per site
- transform pipelines
- variant generation
- audit trails
- object lifecycle hooks
- soft-delete before purge

## 11. Governance Invariants

Media must guarantee:

- no cross-tenant leakage
- deterministic provider resolution
- DB index as source of truth
- cleanup bounded by site
- trace logging on upload and delete
- fail-safe behavior on provider outage

Media is infrastructure. It must behave like a platform service, not a convenience feature.

## 12. Media Capability Matrix (Recommended)

Media is a site-scoped infrastructure spine.

All capabilities are evaluated through core authorization. Themes and plugins do not perform permission checks directly.

### Roles (Site-scoped)

Assumed role vocabulary:

- `super_admin`
- `site_admin`
- `editor`
- `author`
- `contributor`
- `viewer`
- `anonymous`

### Action Surface

Media actions fall into five categories:

1. Upload
2. Read / List
3. Attach / Reference
4. Update Metadata
5. Delete

### Capability Matrix

| Action | super_admin | site_admin | editor | author | contributor | viewer | anonymous |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Upload | Yes | Yes | Yes | Yes | No | No | No |
| List Library | Yes | Yes | Yes | Own/Scoped | No | No | No |
| Read Public Media | Yes | Yes | Yes | Yes | Yes | Yes | Yes (if public) |
| Attach to Content | Yes | Yes | Yes | Own content | No | No | No |
| Update Metadata | Yes | Yes | Yes | Own uploads | No | No | No |
| Delete Media | Yes | Yes | No (soft-delete own optional) | No | No | No | No |

### Derived Capability Set

Recommended explicit capability keys:

- `media.upload`
- `media.list.all`
- `media.list.own`
- `media.attach`
- `media.update.any`
- `media.update.own`
- `media.delete.any`
- `media.delete.own`

RBAC should map roles to capabilities. Media authorization must never rely on raw role checks in runtime feature code.

### Tenant Isolation Invariant

All media operations must include the active site boundary:

- `siteId = currentSiteId`

There is no exception. Even elevated operators require an explicit site context.

### Route-Level Enforcement

Authorization is enforced at transport before storage access:

- `POST /api/media/upload`
- `GET /api/media`
- `PATCH /api/media/:id`
- `DELETE /api/media/:id`

### Optional v1.1 Extensions

Future capability keys may include:

- `media.quota.exceeded`
- `media.private.read`
- `media.variant.generate`
- `media.export`
