# Notification rules: multi-select cameras and events (V5.2)

This change extends the existing notification rule engine. It does not add a new
queue, service, database, or notification path.

## Storage

`notification_rules` keeps its existing columns:

```text
camera_id      single camera id, or NULL for all cameras
event_type     legacy event type (this DVR: motion)
classification person / vehicle / '' (unclassified motion) / NULL (any)
```

Two additive columns were added:

```text
camera_ids     JSON array of camera ids, e.g. [1, 3]
event_types    JSON array of rule filters, e.g. ["person", "vehicle"]
```

The arrays are the source of truth for matching in this version. The legacy
columns are still written, derived from the arrays, so older queries remain
useful:

| Selection | Legacy columns |
| --- | --- |
| one camera | `camera_id = that id` |
| all four cameras | `camera_id = NULL` |
| several cameras | `camera_id = NULL` (arrays still restrict the match) |
| person only | `event_type = motion`, `classification = person` |
| vehicle only | `event_type = motion`, `classification = vehicle` |
| motion only | `event_type = motion`, `classification = ''` |
| several event filters | `event_type = motion`, `classification = NULL` |

## Migration

`EventStore` runs an idempotent additive migration on open:

1. `ALTER TABLE notification_rules ADD COLUMN camera_ids TEXT` and
   `event_types TEXT`, only when the column is missing.
2. After the default seed, every row whose new columns are `NULL` is backfilled
   from its legacy columns. The update never changes `name`, `enabled`,
   schedule, cooldown, `created_at`, or `updated_at`, and never deletes a row.
3. The legacy columns are unchanged for untouched rows. Existing behavior is
   therefore identical.

A row whose legacy event type cannot be represented by the supported filters is
left with `NULL` arrays and continues to use the legacy matcher.

## Matching

`ruleMatches()` in `src/lib/events.ts`:

- If `cameraIds` is present, `event.cameraId` must be in it. An empty array
  matches nothing; it is never “all cameras”.
- If `eventTypes` is present, at least one filter must match:
  - `person` → `type === "motion" && classification === "person"`
  - `vehicle` → `type === "motion" && classification === "vehicle"`
  - `motion` → `type === "motion" && classification === null`
- If the arrays are absent, the legacy single-value fields are used exactly as
  before.

All existing gates remain outside identity matching: enabled, minimum priority,
weekday, schedule window, quiet-hours behavior, cooldown, and the unique
`(event_id, rule_id)` duplicate guard.

## API

`GET/POST /api/notification-rules` and `PATCH/PUT/DELETE /api/notification-rules/<id>`
accept and return:

```json
{
  "cameraIds": [1, 2],
  "eventTypes": ["person", "vehicle"]
}
```

Server-side validation:

- `cameraIds` must be a non-empty array of known camera ids (1–4).
- `eventTypes` must be a non-empty array of `person`, `vehicle`, or `motion`.
- `[]`, unknown ids, unknown tokens, non-arrays, and duplicates that normalize to
  an empty selection are rejected with HTTP 400.
- The old `cameraId` / `eventType` / `classification` body is still accepted and
  converted to arrays.
- A partial PATCH that sends only legacy fields drops inherited arrays so the
  legacy change is not ignored.

The dry-run endpoint `POST /api/notifications/test` evaluates the same
`evaluateRules` and therefore uses the arrays automatically.

## Tests

- `src/server/events/rule-multiselect.test.ts` — tests A–L against the real
  engine and decision writer, plus pipeline integration.
- `src/server/events/rule-input-multiselect.test.ts` — validation.
- `src/server/events/rule-migration.test.ts` — additive migration and backfill.
- `src/app/api/notifications/test/route.test.ts` — dry-run combinations.
- `tests/e2e/notification-rules.spec.ts` — UI create/edit/validation. It only
  runs with `QA_ALLOW_RULE_MUTATIONS=1` against a disposable `DATA_DIR`.
