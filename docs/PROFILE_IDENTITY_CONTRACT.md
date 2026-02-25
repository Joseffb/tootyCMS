# Profile And Identity Contract

This contract defines ownership boundaries for user identity, authentication, and profile UX.

## Scope Ownership (MUST)

- Global user records (`users`, `user_meta`) are the source of truth for:
  - identity (`id`, `name`, `email`)
  - authentication linkage/provider state
  - native password metadata (`force_password_change`)
- Site-level user tables are membership/authorization surfaces only:
  - role and capability assignment per site
  - no duplication of global identity as authority

## UI Ownership (MUST)

- Canonical profile management route is global:
  - `/settings/profile`
- Single-site UX may mirror profile under site settings:
  - `/site/:id/settings/profile`
- Site profile view must read/write the same global identity state.

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
