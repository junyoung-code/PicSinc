-- Extend the durable festival event stream. No foreign keys to 24-hour data.
begin;

alter table public.photo_upload_intents
  add column visit_id uuid,
  add column analytics_context text check (analytics_context in ('test', 'festival'));

alter table public.festival_analytics_events
  alter column session_id drop not null,
  add column visit_id uuid,
  add column device_kind text check (device_kind in ('mobile', 'tablet', 'desktop', 'unknown')),
  add column client_event_id uuid,
  add column stage text check (stage in ('original_upload', 'edited_upload', 'region_claim', 'area_submit', 'composition', 'result_view')),
  add column error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,48}$'),
  add column attempt integer check (attempt is null or attempt between 1 and 100),
  add column queue_ms integer check (queue_ms is null or queue_ms between 0 and 86400000),
  add column download_ms integer check (download_ms is null or download_ms between 0 and 86400000),
  add column processing_ms integer check (processing_ms is null or processing_ms between 0 and 86400000),
  add column upload_ms integer check (upload_ms is null or upload_ms between 0 and 86400000);

alter table public.festival_analytics_events drop constraint festival_analytics_events_event_name_check;
alter table public.festival_analytics_events drop constraint festival_analytics_events_check;
alter table public.festival_analytics_events add constraint festival_analytics_event_name_check check (event_name in (
  'visit_started', 'room_opened', 'room_created', 'participant_joined', 'edited_upload_completed',
  'region_claimed', 'region_released', 'area_submitted', 'composition_requested',
  'composition_succeeded', 'result_displayed', 'save_clicked', 'stage_failed',
  'worker_attempt_started', 'worker_attempt_finished'
));
alter table public.festival_analytics_events add constraint festival_analytics_event_shape_check check (
  (event_name = 'visit_started' and session_id is null and visit_id is not null and device_kind is not null)
  or (event_name = 'stage_failed' and stage = 'original_upload' and session_id is null)
  or (event_name not in ('visit_started', 'stage_failed') and session_id is not null)
  or (event_name = 'stage_failed' and stage <> 'original_upload' and session_id is not null)
);
create unique index festival_analytics_visit_once on public.festival_analytics_events (visit_id) where event_name = 'visit_started';
create unique index festival_analytics_client_once on public.festival_analytics_events (client_event_id) where client_event_id is not null;
create unique index festival_analytics_room_opened_once on public.festival_analytics_events (visit_id, session_id) where event_name = 'room_opened';
create unique index festival_analytics_result_displayed_once on public.festival_analytics_events (visit_id, session_id, asset_id) where event_name = 'result_displayed';
create unique index festival_analytics_composition_requested_once on public.festival_analytics_events (processing_job_id) where event_name = 'composition_requested';
create unique index festival_analytics_worker_attempt_once on public.festival_analytics_events (processing_job_id, attempt, event_name) where event_name in ('worker_attempt_started', 'worker_attempt_finished');
create index festival_analytics_export_scan on public.festival_analytics_events (occurred_at, id);

-- Original-upload preparation captures the chosen mode. Room creation and its
-- first event use that value even if the global default changes meanwhile.
create function public.festival_room_context_from_upload() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  select u.analytics_context into new.event_context from photo_upload_intents u
  where u.session_id = new.session_id and u.kind = 'original';
  if new.event_context is null then
    select event_context into strict new.event_context from festival_analytics_settings where singleton = true;
  end if;
  return new;
end;
$$;
create trigger festival_room_context_from_upload before insert on public.festival_analytics_room_contexts
for each row execute function public.festival_room_context_from_upload();

create function public.festival_room_visit() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.event_name in ('room_created', 'participant_joined') and new.visit_id is null then
    select u.visit_id into new.visit_id from photo_upload_intents u
    where u.session_id = new.session_id and u.kind = 'original' limit 1;
  end if;
  return new;
end;
$$;
create trigger festival_room_visit before insert on public.festival_analytics_events
for each row execute function public.festival_room_visit();

-- Claim events are committed with ownership changes, not with button taps.
create function public.festival_region_claim_event() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform record_festival_analytics_event('region_claimed', new.session_id, new.participant_id);
  elsif exists (select 1 from photo_sessions where id = old.session_id and expires_at > now()) then
    perform record_festival_analytics_event('region_released', old.session_id, old.participant_id);
  end if;
  return null;
end;
$$;
create trigger festival_region_claim_insert after insert on public.region_claims
for each row execute function public.festival_region_claim_event();
create trigger festival_region_claim_delete after delete on public.region_claims
for each row execute function public.festival_region_claim_event();

create function public.prune_festival_analytics_events(p_before timestamptz, p_limit integer default 500)
returns integer language plpgsql security invoker set search_path = public as $$
declare removed integer;
begin
  if p_limit < 1 or p_limit > 1000 or p_before > now() - interval '30 days' then
    raise exception 'Invalid retention boundary';
  end if;
  with old_rows as (
    select id from festival_analytics_events where occurred_at < p_before order by occurred_at, id limit p_limit
  ) delete from festival_analytics_events e using old_rows where e.id = old_rows.id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_festival_analytics_events(timestamptz,integer) from public, anon, authenticated;
grant execute on function public.prune_festival_analytics_events(timestamptz,integer) to service_role;
grant delete on public.festival_analytics_events to service_role;
commit;
