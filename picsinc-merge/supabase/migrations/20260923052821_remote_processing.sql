-- Service-only durable jobs. File bytes never pass through the worker API.
create table public.processing_jobs (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.photo_sessions(id) on delete cascade,
 requested_by uuid not null references public.participants(id) on delete cascade,
 kind text not null check(kind in ('detect','compose')),
 dedupe_key text not null unique,
 input jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','ready','failed')),
 attempts integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 available_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 result jsonb,
 error_code text,
 error_message text
);
alter table public.processing_jobs enable row level security;
revoke all on public.processing_jobs from public,anon,authenticated;
grant all on public.processing_jobs to service_role;
create index processing_jobs_session on public.processing_jobs(session_id);
create index processing_jobs_requester on public.processing_jobs(requested_by);
create index processing_jobs_pending on public.processing_jobs(available_at,created_at) where status in ('queued','running');

-- No room FK: retained after room deletion until all issued upload URLs expire.
create table public.processing_output_grants(path text primary key,session_id uuid not null,remove_after timestamptz not null,capability_expires_at timestamptz not null);
alter table public.processing_output_grants enable row level security;
revoke all on public.processing_output_grants from public,anon,authenticated;
grant all on public.processing_output_grants to service_role;
create index processing_output_grants_expiry on public.processing_output_grants(remove_after);

create function public.enqueue_original_detection() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.kind='original' then
  insert into processing_jobs(session_id,requested_by,kind,dedupe_key,input)
  select new.session_id,s.owner_participant_id,'detect','detect:'||new.id,
    jsonb_build_object('assetId',new.id,'width',new.width,'height',new.height)
  from photo_sessions s where s.id=new.session_id
  on conflict(dedupe_key) do nothing;
 end if;
 return new;
end; $$;
create trigger original_detection_job after insert on public.photo_assets for each row execute function public.enqueue_original_detection();

create function public.enqueue_processing_job(p_session_id uuid,p_participant_id uuid,p_kind text,p_asset_id uuid default null,p_version integer default null,p_retry boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s photo_sessions; a photo_assets; j processing_jobs; k text; payload jsonb; cached jsonb;
begin
 select * into s from photo_sessions where id=p_session_id for update;
 if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
 if not exists(select 1 from participants where id=p_participant_id and session_id=s.id) then raise exception 'Forbidden'; end if;
 if p_kind='detect' then
  select * into a from photo_assets where id=p_asset_id and session_id=s.id;
  if a.id is null or not(a.id=s.original_asset_id or (a.kind='edited' and a.participant_id=p_participant_id)) then raise exception 'Forbidden'; end if;
  k:='detect:'||a.id;
  payload:=jsonb_build_object('assetId',a.id,'width',a.width,'height',a.height);
  if a.id=s.original_asset_id then
   select detection into cached from original_detections where session_id=s.id;
   if cached ? 'storageKey' then
    insert into processing_jobs(session_id,requested_by,kind,dedupe_key,input,status,result)
    values(s.id,p_participant_id,'detect',k,payload,'ready',cached) on conflict(dedupe_key) do nothing;
   end if;
  end if;
 elsif p_kind='compose' then
  if s.owner_participant_id<>p_participant_id then raise exception 'Forbidden'; end if;
  if s.version<>p_version then raise exception 'Version changed'; end if;
  if not exists(select 1 from participants where session_id=s.id and submitted) then raise exception 'No submissions'; end if;
  k:='compose:'||s.id||':'||s.version;
  payload:=jsonb_build_object('sessionId',s.id,'version',s.version,'originalAssetId',s.original_asset_id,
   'selections',coalesce((select jsonb_agg(jsonb_build_object('participantId',c.participant_id,'editedAssetId',c.edited_asset_id,'maskAssetId',c.mask_asset_id)) from selections c join participants p on p.id=c.participant_id where c.session_id=s.id and p.submitted),'[]'::jsonb),
   'overlapAssignments',coalesce((select jsonb_agg(jsonb_build_object('editedAssetId',o.edited_asset_id,'maskAssetId',o.mask_asset_id)) from overlap_assignments o join photo_assets e on e.id=o.edited_asset_id join participants p on p.id=e.participant_id where o.session_id=s.id and p.submitted),'[]'::jsonb));
 else raise exception 'Invalid job kind'; end if;
 insert into processing_jobs(session_id,requested_by,kind,dedupe_key,input) values(s.id,p_participant_id,p_kind,k,payload) on conflict(dedupe_key) do nothing;
 select * into j from processing_jobs where dedupe_key=k for update;
 if p_retry and j.status='failed' then
  update processing_jobs set status='queued',attempts=0,error_code=null,error_message=null,available_at=now(),updated_at=now() where id=j.id returning * into j;
 end if;
 return to_jsonb(j);
end; $$;

create function public.claim_processing_job() returns jsonb language plpgsql security invoker set search_path=public as $$
declare j processing_jobs;
begin
 update processing_jobs set status='failed',error_code='worker_lost',error_message='처리가 중단됐어요. 다시 시도해 주세요.',updated_at=now()
 where status='running' and lease_until<=now() and attempts>=3;
 update processing_jobs j set status='failed',error_code='version_changed',error_message='사진이나 선택이 바뀌었어요. 다시 병합해 주세요.',updated_at=now()
 from photo_sessions s where s.id=j.session_id and j.kind='compose' and j.status in ('queued','running') and s.version<>(j.input->>'version')::integer;
 select q.* into j from processing_jobs q join photo_sessions s on s.id=q.session_id
 where s.expires_at>now() and q.attempts<3 and ((q.status='queued' and q.available_at<=now()) or (q.status='running' and q.lease_until<=now()))
 order by q.created_at,q.id limit 1 for update of q skip locked;
 if j.id is null then return null; end if;
 update processing_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',updated_at=now(),error_code=null,error_message=null where id=j.id returning * into j;
 return to_jsonb(j);
end; $$;

create function public.heartbeat_processing_job(p_id uuid,p_lease_token uuid) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update processing_jobs j set lease_until=now()+interval '120 seconds',updated_at=now()
 from photo_sessions s where j.id=p_id and j.lease_token=p_lease_token and j.status='running' and j.lease_until>now() and s.id=j.session_id and s.expires_at>now()
 and (j.kind<>'compose' or s.version=(j.input->>'version')::integer);
 return found;
end; $$;

create function public.fail_processing_job(p_id uuid,p_lease_token uuid,p_code text) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update processing_jobs set status=case when p_code='transient' and attempts<3 then 'queued' else 'failed' end,
 error_code=p_code,error_message='처리하지 못했어요. 다시 시도해 주세요.',available_at=now()+interval '10 seconds',lease_until=null,updated_at=now()
 where id=p_id and lease_token=p_lease_token and status='running' and lease_until>now();
 return found;
end; $$;

create function public.complete_processing_job(p_id uuid,p_lease_token uuid,p_result jsonb) returns boolean language plpgsql security invoker set search_path=public as $$
declare j processing_jobs; s photo_sessions; original photo_assets; prefix text; assets jsonb; output jsonb; preview_id uuid; result_id uuid; existing jsonb;
begin
 -- Same lock order as enqueue: room before job, preventing deadlocks with concurrent edits.
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
 return true;
end; $$;

-- All functions are invoked by the authenticated server, never by browser roles.
revoke all on function public.enqueue_original_detection(),public.enqueue_processing_job(uuid,uuid,text,uuid,integer,boolean),public.claim_processing_job(),public.heartbeat_processing_job(uuid,uuid),public.fail_processing_job(uuid,uuid,text),public.complete_processing_job(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_original_detection(),public.enqueue_processing_job(uuid,uuid,text,uuid,integer,boolean),public.claim_processing_job(),public.heartbeat_processing_job(uuid,uuid),public.fail_processing_job(uuid,uuid,text),public.complete_processing_job(uuid,uuid,jsonb) to service_role;

-- Main integrates this draft into the remote-worker migration. No live DB changes here.
-- No FK to photo_sessions: keep cleanup tombstones after a room is deleted.
create table public.photo_upload_intents (
  id uuid primary key,
  kind text not null check (kind in ('original','edited','mask')),
  session_id uuid not null,
  participant_id uuid not null,
  asset_id uuid not null unique,
  invite_token text not null,
  nickname text,
  owner_hash text not null,
  session_token_hash text,
  recovery_token_hash text,
  content_type text not null check (content_type in ('image/png','image/jpeg')),
  byte_size integer not null check (byte_size between 1 and 20971520),
  temporary_key text not null unique,
  final_key text not null unique,
  expires_at timestamptz not null,
  status text not null default 'uploading' check (status in ('uploading','verifying','ready')),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind <> 'original' or (nickname is not null and char_length(nickname) between 1 and 40 and session_token_hash is not null and recovery_token_hash is not null))
);
create index photo_upload_intents_expiry on public.photo_upload_intents(expires_at);
create index photo_upload_intents_session on public.photo_upload_intents(session_id);
alter table public.photo_upload_intents enable row level security;
revoke all on public.photo_upload_intents from public, anon, authenticated;
grant all on public.photo_upload_intents to service_role;

create function public.claim_photo_upload(p_upload_id uuid, p_owner_hash text, p_lease_token uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare u photo_upload_intents;
begin
  select * into u from photo_upload_intents where id=p_upload_id for update;
  if u.id is null then raise exception 'Upload missing'; end if;
  if u.owner_hash is distinct from p_owner_hash then raise exception 'Upload unauthorized'; end if;
  if u.expires_at <= now() then raise exception 'Upload expired'; end if;
  if u.kind <> 'original' and not exists (
    select 1 from participant_credentials c join photo_sessions s on s.id=c.session_id
    where c.session_id=u.session_id and c.participant_id=u.participant_id and c.session_token_hash=p_owner_hash and s.expires_at>now()
  ) then raise exception 'Upload unauthorized'; end if;
  if u.status='ready' then return to_jsonb(u); end if;
  if u.status='verifying' and u.lease_expires_at>now() then raise exception 'Upload busy'; end if;
  update photo_upload_intents set status='verifying',lease_token=p_lease_token,lease_expires_at=now()+interval '120 seconds'
    where id=u.id returning * into u;
  return to_jsonb(u);
end; $$;

create function public.finalize_original_upload(p_upload_id uuid, p_owner_hash text, p_lease_token uuid, p_width integer, p_height integer, p_content_type text)
returns void language plpgsql security invoker set search_path = public as $$
declare u photo_upload_intents;
begin
  select * into u from photo_upload_intents where id=p_upload_id for update;
  if u.id is null then raise exception 'Upload missing'; end if;
  if u.kind<>'original' or u.owner_hash is distinct from p_owner_hash then raise exception 'Upload unauthorized'; end if;
  if u.expires_at <= now() then raise exception 'Upload expired'; end if;
  if u.status='ready' then return; end if;
  if u.status<>'verifying' or u.lease_token is distinct from p_lease_token or u.lease_expires_at <= now() then raise exception 'Upload lease lost'; end if;
  if p_width is null or p_height is null or p_width<=0 or p_height<=0 or p_width::bigint*p_height>40000000 or p_content_type is distinct from u.content_type then raise exception 'Invalid upload'; end if;
  -- create_photo_session and main's original-analysis enqueue trigger run atomically here.
  perform create_photo_session(u.session_id,u.invite_token,u.asset_id,now(),now()+interval '24 hours',u.participant_id,u.nickname,u.session_token_hash,u.recovery_token_hash,u.final_key,p_width,p_height,p_content_type);
  update photo_upload_intents set status='ready',lease_token=null,lease_expires_at=null where id=u.id;
end; $$;

create function public.finalize_session_upload(p_upload_id uuid, p_owner_hash text, p_lease_token uuid, p_width integer, p_height integer, p_content_type text)
returns void language plpgsql security invoker set search_path = public as $$
declare u photo_upload_intents; c participant_credentials; s photo_sessions;
begin
  select * into u from photo_upload_intents where id=p_upload_id for update;
  if u.id is null then raise exception 'Upload missing'; end if;
  if u.kind not in ('edited','mask') or u.owner_hash is distinct from p_owner_hash then raise exception 'Upload unauthorized'; end if;
  if u.expires_at <= now() then raise exception 'Upload expired'; end if;
  select * into s from photo_sessions where id=u.session_id for update;
  if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
  -- Lock room before credentials, matching room-deletion lock order.
  -- Recovery cannot revoke credentials between validation and registration.
  select * into c from participant_credentials where session_id=u.session_id and participant_id=u.participant_id for update;
  if c.participant_id is null or c.session_token_hash is distinct from p_owner_hash then raise exception 'Upload unauthorized'; end if;
  if u.status='ready' then return; end if;
  if u.status<>'verifying' or u.lease_token is distinct from p_lease_token or u.lease_expires_at <= now() then raise exception 'Upload lease lost'; end if;
  if p_width is null or p_height is null or p_width<=0 or p_height<=0 or p_width::bigint*p_height>40000000 or p_content_type is distinct from u.content_type then raise exception 'Invalid upload'; end if;
  perform register_photo_asset(jsonb_build_object('id',u.asset_id,'sessionId',u.session_id,'participantId',u.participant_id,'kind',u.kind,'storageKey',u.final_key,'width',p_width,'height',p_height,'contentType',p_content_type));
  update photo_upload_intents set status='ready',lease_token=null,lease_expires_at=null where id=u.id;
end; $$;

revoke all on function public.claim_photo_upload(uuid,text,uuid), public.finalize_original_upload(uuid,text,uuid,integer,integer,text), public.finalize_session_upload(uuid,text,uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.claim_photo_upload(uuid,text,uuid), public.finalize_original_upload(uuid,text,uuid,integer,integer,text), public.finalize_session_upload(uuid,text,uuid,integer,integer,text) to service_role;

-- Cleanup integration requirements:
-- Keep temporary files until expires_at + 1 hour so a still-valid signed capability
-- cannot replace its source after cleanup. This also covers signing/request latency.
-- After that grace remove temporary_key; remove final_key ONLY if no photo_asset
-- references it. Keep retrying deletion until successful before deleting this row.
-- Session-expiration cleanup may remove final_key earlier but must keep the intent
-- tombstone through expires_at + 1 hour (late finalizers/uploads get re-cleaned).
