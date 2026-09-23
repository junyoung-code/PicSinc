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
