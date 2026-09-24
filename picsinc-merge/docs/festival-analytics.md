# Festival analytics events

The `festival_analytics_events` table is an append-only funnel source. It has no
foreign keys to rooms, participants, assets, or jobs, so the normal 24-hour room
cleanup does not remove its rows.

## Event meanings

- `room_created`: the original asset, owner, credentials, and room were committed.
- `participant_joined`: a participant and credentials were committed. The owner
  receives this event in the room-creation transaction too.
- `edited_upload_completed`: an `edited` asset was registered in `photo_assets`.
- `area_submitted`: `replace_selection` committed with `submitted=true`.
- `composition_succeeded`: result assets were published and the compose job was
  committed as `ready`.

Raw `area_submitted` events retain later successful submissions by the same room
participant. Raw `composition_succeeded` events retain later successful compose
jobs for newer room versions. Use `festival_analytics_first_completions` for
"completed at least once": it returns the first area submission per room
participant and the first successful composition per room.

## Test and festival separation

The migration starts with `festival_analytics_settings.event_context = 'test'`
so verification traffic cannot silently count as festival usage. The setting is
read only when `room_created` is written. Every later event inherits that room's
immutable row in `festival_analytics_room_contexts`, so changing the setting
cannot split an active room across test and festival data. Rooms already active
when the migration is applied are seeded as `test` without inventing historical
events. Before opening festival traffic, a privileged operator must run:

```sql
update public.festival_analytics_settings
set event_context = 'festival'
where singleton = true;
```

Do this only after migration verification and before admitting real festival
traffic. Existing rooms remain entirely in their original context and new rooms
use the updated context. Later setting changes never relabel existing records.

## Privacy and deployment checks

The event table stores only the existing per-room session, participant, asset,
and processing-job UUIDs needed for funnel deduplication. It creates no user or
device identity. Never add invite tokens, nicknames, image data, storage paths,
session/recovery credentials, or arbitrary cross-room identity fields.

Before deployment, review the migration against the functions currently present
in the target database, apply it in a non-production project, exercise every
success and retry path, delete/expire a room, and confirm its analytics rows
remain. Then clear or retain `test` rows according to the analysis plan and switch
the singleton context to `festival` before real traffic starts.

## Local database verification

The numbered migration directory is not a complete blank-database baseline: the
initial schema and pre-numbered updates live under `src/integrations/storage`.
Therefore a plain migration-only reset cannot reproduce the current schema.

`tests/integration/festival-analytics-db.test.ts` creates an isolated PostgreSQL
database and applies, in order, `schema.sql`, `integration.sql`,
`multiple-selections.sql`, `mobile-flow.sql`, and every numbered migration. It
then exercises the real SQL functions and cascade deletion. PGlite does not ship
Supabase's `pgcrypto`, Storage, Vault, `pg_cron`, or `pg_net` services, so the test
provides minimal Storage/role stubs, omits only the `pgcrypto` declaration, and
does not execute `cleanup.sql`. Run it with:

```sh
node --import tsx --test tests/integration/festival-analytics-db.test.ts
```
