# Comment Identity Flow

## Request Path
1. Theme client loads comments via `GET /api/comments`.
2. API resolves session from `getSession()`.
3. API resolves provider capabilities from `getPublicCommentCapabilities()`.
4. API lists comments from `listComments()` (signed-in, capability-scoped) or `listPublicComments()` (approved only).
5. API enriches author presentation metadata for signed-in authors.
6. API returns comments + permissions for theme rendering.

## Create Path
1. Theme submits `POST /api/comments` with comment body.
2. If anonymous flow is active, payload includes `authorName` + `authorEmail`.
3. API enforces capability/path rules:
   - signed-in: authenticated-posting enabled + `site.comment.create`.
   - anonymous: anonymous-posting enabled + required fields.
4. API writes comment through `createComment()` in `lib/comments-spine.ts` provider orchestration.
5. Provider stores metadata in site-scoped comment meta table.

## Identity Rules Enforced
- Signed-in comments use:
  - `user_meta.display_name` first
  - fallback: `users.username`
  - never `users.name`
  - never `users.email`
- Anonymous comments use submitted display name for public rendering.
- Anonymous email is stored for moderation only and removed from public response payloads.

## Leak Prevention
- Public response metadata is sanitized by `sanitizePublicCommentMetadata()`.
- Keys like `author_email`, `email`, and `*_email` are stripped from API responses.
- Theme renders `author_display_name`/`author_name` only.

## Tenant Isolation
- Entry-context validation in spine verifies `domain_posts.siteId` and `domain_posts.id` match requested site.
- This prevents cross-site comment context usage and identity bleed between tenants.

