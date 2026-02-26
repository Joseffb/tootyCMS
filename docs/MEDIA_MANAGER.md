# Media Manager

Tooty uses a site-scoped media library backed by a shared object store and a DB index table.

## Storage model

Object storage is shared (Blob/S3), partitioned by `siteId` key prefix:

- `siteId/<filename>`

DB index table:

- `tooty_media`

Tracks:

- `siteId`
- `userId`
- `provider` (`blob` or `s3` or `dbblob`)
- `bucket`
- `objectKey`
- `url`
- `label`
- `mimeType`
- `size`
- timestamps

## Upload pipeline

Client upload flow:

1. `uploadSmart` tries `/api/uploadImage` (Vercel Blob)
2. Fallback to `/api/uploadImageLocal` (AWS S3)
3. Final fallback to `/api/uploadImageDb` (DB blob data URL, intended for low-volume/dev fallback)
4. Upload route writes/updates row in `tooty_media`

All provider routes are traced in debug mode.

Provider mode can be forced with env `MEDIA_UPLOAD_PROVIDER=auto|blob|s3|dbblob`.

## Editor integration

Editor supports two media paths:

1. Upload new image via paste/drop/slash upload
2. Insert existing site media from Media Library

Media Library behavior:

- Loads `/api/media?siteId=<siteId>`
- Shows site-scoped list only
- Includes modal picker (`Open Media`) and quick list insert

## Access and auth

`/api/media` enforces:

- authenticated session
- site ownership or admin role

## Public rendering requirements

For S3-backed assets to render on public pages, bucket/object read must be public (policy-based in this setup).

## Why keep DB media index

1. Reuse assets in editor without reupload
2. Site-level media inventory
3. Future cleanup/usage reporting
4. Provider-agnostic media retrieval

## Cleanup jobs

Core scheduler supports a retention cleanup action:

- `core.media.cleanup` (alias `media.cleanup`)

Payload options:

- `olderThanDays` (default `30`)
- `limit` (default `100`)
- `siteId` (optional override; defaults to schedule `siteId`)

This cleanup removes old rows from `tooty_media` in bounded batches.
