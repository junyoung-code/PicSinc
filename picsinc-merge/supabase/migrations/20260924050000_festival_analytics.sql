-- Durable, privacy-minimal product events for the festival dashboard.
-- These rows intentionally have no foreign keys to the 24-hour room tables.
begin;

create table public.festival_analytics_settings (
  singleton boolean primary key default true check (singleton),
  event_context text not null check (event_context in ('test', 'festival'))
);

insert into public.festival_analytics_settings (singleton, event_context)
values (true, 'test');

create table public.festival_analytics_room_contexts (
  session_id uuid primary key,
  event_context text not null check (event_context in ('test', 'festival')),
  assigned_at timestamptz not null default clock_timestamp()
);

-- Rooms that predate this migration did not emit room_created. Keep their later
-- traffic working and explicitly classify it as pre-festival verification data.
insert into public.festival_analytics_room_contexts (session_id, event_context)
select id, 'test' from public.photo_sessions;

create table public.festival_analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null check (event_name in (
    'room_created',
    'participant_joined',
    'edited_upload_completed',
    'area_submitted',
    'composition_succeeded'
  )),
  event_context text not null check (event_context in ('test', 'festival')),
  occurred_at timestamptz not null default clock_timestamp(),
  session_id uuid not null,
  participant_id uuid,
  asset_id uuid,
  processing_job_id uuid,
  session_version integer check (session_version is null or session_version > 0),
  check (
    (event_name = 'room_created' and participant_id is null and asset_id is null and processing_job_id is null and session_version = 1)
    or (event_name = 'participant_joined' and participant_id is not null and asset_id is null and processing_job_id is null and session_version is not null)
    or (event_name = 'edited_upload_completed' and participant_id is not null and asset_id is not null and processing_job_id is null and session_version is not null)
    or (event_name = 'area_submitted' and participant_id is not null and asset_id is null and processing_job_id is null and session_version is not null)
    or (event_name = 'composition_succeeded' and participant_id is null and asset_id is null and processing_job_id is not null and session_version is not null)
  )
);

-- The natural success identity of each operation makes retries harmless while
-- still retaining later submissions and compositions as separate raw events.
create unique index festival_analytics_room_created_once
  on public.festival_analytics_events (event_name, session_id)
  where event_name = 'room_created';
create unique index festival_analytics_participant_joined_once
  on public.festival_analytics_events (event_name, participant_id)
  where event_name = 'participant_joined';
create unique index festival_analytics_edited_upload_once
  on public.festival_analytics_events (event_name, asset_id)
  where event_name = 'edited_upload_completed';
create unique index festival_analytics_area_submission_once_per_version
  on public.festival_analytics_events (event_name, session_id, participant_id, session_version)
  where event_name = 'area_submitted';
create unique index festival_analytics_composition_once
  on public.festival_analytics_events (event_name, processing_job_id)
  where event_name = 'composition_succeeded';
create index festival_analytics_dashboard_scan
  on public.festival_analytics_events (event_context, event_name, occurred_at);

alter table public.festival_analytics_settings enable row level security;
alter table public.festival_analytics_room_contexts enable row level security;
alter table public.festival_analytics_events enable row level security;
revoke all on public.festival_analytics_settings, public.festival_analytics_room_contexts, public.festival_analytics_events from public, anon, authenticated;
grant select, update on public.festival_analytics_settings to service_role;
grant select, insert on public.festival_analytics_room_contexts to service_role;
grant select, insert on public.festival_analytics_events to service_role;
grant usage, select on sequence public.festival_analytics_events_id_seq to service_role;

create function public.record_festival_analytics_event(
  p_event_name text,
  p_session_id uuid,
  p_participant_id uuid default null,
  p_asset_id uuid default null,
  p_processing_job_id uuid default null,
  p_session_version integer default null
) returns void language plpgsql security invoker set search_path = public as $$
declare context_name text;
begin
  if p_event_name = 'room_created' then
    insert into festival_analytics_room_contexts (session_id, event_context)
    select p_session_id, event_context
    from festival_analytics_settings where singleton = true
    on conflict (session_id) do nothing;
  end if;

  -- The setting is only the default for a new room. Every later event inherits
  -- the immutable room context, so changing test -> festival cannot split a room.
  select event_context into strict context_name
  from festival_analytics_room_contexts where session_id = p_session_id;

  insert into festival_analytics_events (
    event_name, event_context, session_id, participant_id, asset_id,
    processing_job_id, session_version
  ) values (
    p_event_name, context_name, p_session_id, p_participant_id, p_asset_id,
    p_processing_job_id, p_session_version
  ) on conflict do nothing;
end;
$$;

revoke all on function public.record_festival_analytics_event(text,uuid,uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.record_festival_analytics_event(text,uuid,uuid,uuid,uuid,integer) to service_role;

-- Room creation is the successful original-upload transaction. Record the owner
-- as a participant in that same transaction so participant counts include them.
create or replace function public.create_photo_session(p_session_id uuid, p_invite_token text, p_original_asset_id uuid, p_created_at timestamptz, p_expires_at timestamptz, p_participant_id uuid, p_nickname text, p_session_token_hash text, p_recovery_token_hash text, p_storage_key text, p_width integer, p_height integer, p_content_type text) returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into photo_sessions (id, invite_token, original_asset_id, owner_participant_id, created_at, expires_at) values (p_session_id, p_invite_token, p_original_asset_id, p_participant_id, p_created_at, p_expires_at);
  insert into participants (id, session_id, nickname) values (p_participant_id, p_session_id, p_nickname);
  insert into participant_credentials values (p_participant_id, p_session_id, p_session_token_hash, p_recovery_token_hash);
  insert into photo_assets (id, session_id, participant_id, kind, storage_key, width, height, content_type) values (p_original_asset_id, p_session_id, null, 'original', p_storage_key, p_width, p_height, p_content_type);
  perform record_festival_analytics_event('room_created', p_session_id, p_session_version => 1);
  perform record_festival_analytics_event('participant_joined', p_session_id, p_participant_id, p_session_version => 1);
end;
$$;

create or replace function public.join_photo_session(p_session_id uuid, p_participant_id uuid, p_nickname text, p_session_token_hash text, p_recovery_token_hash text) returns void language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version = version + 1 where id = p_session_id and expires_at > now() and owner_participant_id is not null returning version into next_version;
  if next_version is null then raise exception 'Session expired'; end if;
  insert into participants(id, session_id, nickname) values(p_participant_id, p_session_id, p_nickname);
  insert into participant_credentials values(p_participant_id, p_session_id, p_session_token_hash, p_recovery_token_hash);
  perform record_festival_analytics_event('participant_joined', p_session_id, p_participant_id, p_session_version => next_version);
end;
$$;

create or replace function public.register_photo_asset(p_asset jsonb) returns jsonb language plpgsql security invoker set search_path = public as $$
declare s photo_sessions; original photo_assets; a photo_assets; next_order integer; next_version integer;
begin
  select * into s from photo_sessions where id=(p_asset->>'sessionId')::uuid for update;
  if s.id is null or s.expires_at <= now() then raise exception 'Session expired'; end if;
  if not exists(select 1 from participants where id=(p_asset->>'participantId')::uuid and session_id=s.id) or p_asset->>'kind' not in ('edited','mask') then raise exception 'Invalid asset owner'; end if;
  select * into original from photo_assets where id=s.original_asset_id;
  if original.width <> (p_asset->>'width')::integer or original.height <> (p_asset->>'height')::integer then raise exception 'Invalid asset dimensions'; end if;
  if p_asset->>'kind'='edited' then
    select coalesce(max(upload_order),0)+1 into next_order from photo_assets where session_id=s.id;
  end if;
  insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type,upload_order)
  values((p_asset->>'id')::uuid,s.id,(p_asset->>'participantId')::uuid,p_asset->>'kind',p_asset->>'storageKey',(p_asset->>'width')::integer,(p_asset->>'height')::integer,p_asset->>'contentType',next_order) returning * into a;
  if a.kind='edited' then
    update participants set submitted=false where id=a.participant_id;
    update photo_sessions set version=version+1 where id=s.id returning version into next_version;
    perform record_festival_analytics_event('edited_upload_completed', s.id, a.participant_id, a.id, p_session_version => next_version);
  end if;
  return to_jsonb(a);
end;
$$;

create or replace function public.replace_selection(p_session_id uuid, p_participant_id uuid, p_edited_asset_id uuid, p_mask_asset_id uuid, p_expected_version integer, p_submitted boolean) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version=version+1 where id=p_session_id and version=p_expected_version and expires_at>now() returning version into next_version;
  if next_version is null then return null; end if;
  if not exists(select 1 from original_selections where participant_id=p_participant_id and session_id=p_session_id) then raise exception 'Original selection required'; end if;
  if not exists(select 1 from photo_assets where id=p_edited_asset_id and session_id=p_session_id and participant_id=p_participant_id and kind='edited') or not exists(select 1 from photo_assets where id=p_mask_asset_id and session_id=p_session_id and participant_id=p_participant_id and kind='mask') then raise exception 'Invalid selection assets'; end if;
  insert into selections(participant_id,session_id,edited_asset_id,mask_asset_id) values(p_participant_id,p_session_id,p_edited_asset_id,p_mask_asset_id)
  on conflict(participant_id,edited_asset_id) do update set mask_asset_id=excluded.mask_asset_id;
  update participants set submitted=p_submitted where id=p_participant_id and session_id=p_session_id;
  if p_submitted then
    perform record_festival_analytics_event('area_submitted', p_session_id, p_participant_id, p_session_version => next_version);
  end if;
  return next_version;
end;
$$;

create or replace function public.complete_processing_job(p_id uuid,p_lease_token uuid,p_result jsonb) returns boolean language plpgsql security invoker set search_path=public as $$
declare j processing_jobs; s photo_sessions; original photo_assets; prefix text; assets jsonb; output jsonb; preview_id uuid; result_id uuid; existing jsonb;
begin
  select ps.* into s from photo_sessions ps join processing_jobs q on q.session_id=ps.id where q.id=p_id for update of ps;
  if s.id is null or s.expires_at<=now() then return false; end if;
  select * into j from processing_jobs where id=p_id for update;
  if j.lease_token is distinct from p_lease_token then return false; end if;
  if j.status='ready' then return true; end if;
  if j.status<>'running' or j.lease_until<=now() then return false; end if;
  prefix:=s.id||'/'||j.id||'_'||j.lease_token;
  if j.kind='detect' then
    select * into original from photo_assets where id=(j.input->>'assetId')::uuid and session_id=s.id;
    if original.id is null or (p_result->>'width')::integer is distinct from original.width or (p_result->>'height')::integer is distinct from original.height then raise exception 'Invalid result dimensions'; end if;
    output:=p_result||jsonb_build_object('storageKey',prefix||'_detection.json');
    if original.id=s.original_asset_id then
      insert into original_detections(session_id,detection) values(s.id,output) on conflict(session_id) do nothing;
      select detection into existing from original_detections where session_id=s.id;
      if existing ? 'storageKey' then output:=existing; end if;
    end if;
  else
    if s.version<>(j.input->>'version')::integer then
      update processing_jobs set status='failed',error_code='version_changed',error_message='사진이나 선택이 바뀌었어요. 다시 병합해 주세요.',updated_at=now() where id=j.id;
      return false;
    end if;
    preview_id:=gen_random_uuid(); result_id:=gen_random_uuid();
    output:=jsonb_build_object('sessionId',s.id,'version',s.version,'previewAssetId',preview_id,'resultAssetId',result_id,'width',p_result->'width','height',p_result->'height','unassignedOverlapPixels',p_result->'unassignedOverlapPixels');
    assets:=jsonb_build_array(jsonb_build_object('id',preview_id,'sessionId',s.id,'kind','preview','storageKey',prefix||'_preview.png','width',p_result->'previewWidth','height',p_result->'previewHeight'),jsonb_build_object('id',result_id,'sessionId',s.id,'kind','result','storageKey',prefix||'_result.png','width',p_result->'width','height',p_result->'height'));
    if not publish_composition(output,assets,j.requested_by) then return false; end if;
  end if;
  update processing_jobs set status='ready',result=output,lease_until=null,updated_at=now() where id=j.id;
  if j.kind='compose' then
    perform record_festival_analytics_event('composition_succeeded', s.id, p_processing_job_id => j.id, p_session_version => s.version);
  end if;
  return true;
end;
$$;

-- Raw events retain every later successful submission/composition. This view is
-- the dashboard denominator when the question is "ever completed at least once".
create view public.festival_analytics_first_completions
with (security_invoker = true) as
select id, event_name, event_context, occurred_at, session_id, participant_id,
  asset_id, processing_job_id, session_version
from (
  select events.*,
    row_number() over (
      partition by event_context, event_name, session_id,
        case when event_name = 'area_submitted' then participant_id end
      order by occurred_at, id
    ) as completion_number
  from public.festival_analytics_events events
  where event_name in ('area_submitted', 'composition_succeeded')
) ranked
where completion_number = 1;

revoke all on public.festival_analytics_first_completions from public, anon, authenticated;
grant select on public.festival_analytics_first_completions to service_role;

comment on table public.festival_analytics_events is
  'Append-only festival funnel events. Contains no invite tokens, nicknames, image data, storage paths, or authentication data.';
comment on view public.festival_analytics_first_completions is
  'First area submission per room participant and first successful composition per room, separated by event_context.';

commit;
