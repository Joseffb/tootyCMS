# Profile And Identity Contract

This contract defines ownership boundaries for user identity, authentication, and profile UX.

## Scope Ownership (MUST)

- Global user records (`users`, `user_meta`) are the source of truth for:
  - identity (`id`, `name`, `email`)
  - authentication linkage/provider state
  - native password metadata (`force_password_change`)
  - profile presentation metadata (`display_name`, `profile_image_url`)
- Site-level user tables are membership/authorization surfaces only:
  - role and capability assignment per site
  - no duplication of global identity as authority

## UI Ownership (MUST)

- Canonical profile management route is global:
  - `/settings/profile`
- Single-site UX may mirror profile under site settings:
  - `/site/:id/settings/profile`
- Site profile view must read/write the same global identity state.

## Core Profile Service Contract

Core owns profile reads and writes through the core profile surface:

- `core.profile.create`
- `core.profile.read`
- `core.profile.update`

Notes:

- This is a global identity service, not a site-scoped service.
- `profile_image_url` is stored in `network_user_meta`, not on site membership tables.
- Clearing a profile image is an update to empty value, not a delete flow.

## Theme Exposure Contract

Themes may read profile presentation data only through Core-provided DTO/context surfaces.

- canonical theme-safe shape: `core.profile.*`
- current fields:
  - `core.profile.logged_in`
  - `core.profile.display_name`
  - `core.profile.image_url`

Themes must not query profile tables or user meta directly.

## Auth Reset Contract (MUST)

- Admin may set a temporary native password for a user.
- Admin may mark that password as `force_password_change=true`.
- On next native login, user must be redirected to profile password update flow.
- User password update clears force-change flag.

## Extension Hook Contract

Profile page is extensible through kernel filter:

- Filter: `admin:profile:sections`
- Input value: `ProfileSection[]`
- Return value: `ProfileSection[]`
- Context fields:
  - `siteId?: string | null`
  - `userId: string`
  - `role: string`

`ProfileSection` shape:

- `id: string` (stable identifier)
- `title: string`
- `description?: string`
- `rows?: Array<{ label: string; value: string }>`
