# Scheduler

Scheduler execution is driven by a cron ping to Core.

## Endpoint to ping

- URL: `/api/cron/run`
- Methods: `POST` (primary), `GET` (manual/testing)
- Auth: `Authorization: Bearer <token>`
- Token env: `CRON_RUN_TOKEN` (fallback: `AUTH_BEARER_TOKEN`)

If no token is configured, cron requests are rejected with `401`.

## Setup

1. Set `CRON_RUN_TOKEN` in runtime env.
2. In admin, open `Settings > Schedules`:
   - enable `Enable schedules`
   - optionally enable `Ping sitemap endpoint on schedule run`
3. Configure your cron provider to call `/api/cron/run` on your chosen interval.

## Ping examples

```bash
curl -X POST "https://your-domain.com/api/cron/run" \
  -H "Authorization: Bearer $CRON_RUN_TOKEN"
```

Optional trace id for log correlation:

```bash
curl -X POST "https://your-domain.com/api/cron/run" \
  -H "Authorization: Bearer $CRON_RUN_TOKEN" \
  -H "x-trace-id: manual-scheduler-test"
```

## Response semantics

- `200`: run completed; payload includes `ran`, `skipped`, `errors`.
- `202`: runner lock busy (`busy: true`), safe to retry next interval.
- `401`: missing/invalid bearer token.
- `500`: execution failure.

## Reliability model

Scheduler entries support retry/backoff/dead-letter behavior:

- `max_retries` controls max consecutive retry attempts before dead-letter.
- `backoff_base_seconds` controls exponential retry backoff base.
- `retry_count` tracks consecutive failed attempts.
- `dead_lettered` / `dead_lettered_at` mark exhausted schedules.

Execution behavior:

1. `success|skipped|blocked` resets `retry_count` and schedules next normal run.
2. `error` retries using exponential backoff (`base * 2^(attempt-1)`).
3. If retries exceed `max_retries`, status transitions to `dead_letter` and scheduler stops automatic execution for that entry until explicitly re-enabled/updated.

Per-run audit records are stored in `"<CMS_DB_PREFIX>scheduled_action_runs"` and include:

- trigger (`cron|manual`)
- final status
- error text (if any)
- duration
- retry attempt number
- payload snapshot

## Ownership and governance

- Scheduled actions are stored in `"<CMS_DB_PREFIX>scheduled_actions"`.
- Schedule run audits are stored in `"<CMS_DB_PREFIX>scheduled_action_runs"`.
- Admin can edit/delete any schedule.
- Non-admin extension APIs can only mutate schedules owned by that extension.
- Missing action handlers fail gracefully and are marked as `skipped`/`error` on the entry.

## Core action catalog (current)

- `core.ping_sitemap`
- `core.http_ping`
- `core.communication.retry`
- `core.communication.purge`
- `core.webcallbacks.purge`
- `core.webhooks.retry`
- `core.media.cleanup` (age-based cleanup for `tooty_media` rows; payload supports `olderThanDays`, `limit`, `siteId`)
- `core.content.publish`
- `core.content.unpublish`

## Extension integration

Plugins and themes can create/list/update/delete schedule records through the internal extension API.
Plugin runtime can additionally register executable schedule handlers (`registerScheduleHandler`) when the plugin declares `capabilities.scheduleJobs=true`.
