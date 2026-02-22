# Tracing

Tracing is enabled in debug mode and records structured events for lifecycle, middleware, media, and upload flows.

## Debug mode

Debug mode is enabled when either:

- `DEBUG_MODE=true`
- `NEXT_PUBLIC_DEBUG_MODE=true`
- or `NODE_ENV=development`

## Output targets

When debug mode is on:

1. Trace events are emitted to console using:
   - `trace(scope, message, payload?)`
2. Trace events are persisted as JSONL on local Node runtime:
   - `logs/traces/YYYY-MM-DD.jsonl`

## Trace tier prefix

Each trace is tagged with a tier prefix:

- `Test`
- `Dev`
- `Prod`

Resolution order:

1. `TRACE_PROFILE` (`test|dev|prod`)
2. fallback by `NODE_ENV`
3. default `Dev`

Each line is a JSON object:

```json
{
  "ts": "2026-02-20T22:13:59.871Z",
  "tier": "Dev",
  "scope": "media.api",
  "message": "request success",
  "payload": { "traceId": "...", "siteId": "...", "count": 1 }
}
```

## Redaction

Sensitive payload fields are redacted before logging:

- keys matching: `token|secret|password|key|authorization|cookie`

Long string payloads are truncated.

## Request correlation

Middleware assigns or propagates `x-trace-id`:

- Incoming request gets `traceId`
- Rewrites/redirects preserve `x-trace-id`
- API routes can read and emit the same trace id

## Instrumented areas (current)

- Middleware request normalization + rewrites
- Kernel lifecycle events:
  - action registration/begin/end
  - filter registration/begin/end
  - menu registration/additions
- Media API (`/api/media`)
- Upload flow:
  - client uploader (`uploadSmart`)
  - Blob upload route (`/api/uploadImage`)
  - Local/S3 upload route (`/api/uploadImageLocal`)

## Runtime notes

- File-based JSONL writing is best-effort and intended for local Node runtime.
- In Edge runtime, trace logging falls back to console behavior only.

## Operational workflow

After each major update:

1. Trigger the affected route/feature.
2. Inspect latest trace file:
   - `logs/traces/<today>.jsonl`
3. Verify start/success/error events for the updated flow.
