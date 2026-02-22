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

## Ownership and governance

- Scheduled actions are stored in `"<CMS_DB_PREFIX>scheduled_actions"`.
- Admin can edit/delete any schedule.
- Non-admin extension APIs can only mutate schedules owned by that extension.
- Missing action handlers fail gracefully and are marked as `skipped`/`error` on the entry.

## Extension integration

Plugins and themes can create/list/update/delete schedule records through the internal extension API.
Plugin runtime can additionally register executable schedule handlers (`registerScheduleHandler`) when the plugin declares `capabilities.scheduleJobs=true`.
