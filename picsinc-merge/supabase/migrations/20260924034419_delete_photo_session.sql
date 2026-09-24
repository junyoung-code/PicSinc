-- Keep a minimal tombstone after expired-room cleanup, so old links show deletion.
create table public.photo_session_deletions (
  invite_token text primary key,
  session_id uuid not null unique,
  deleted_at timestamptz not null default now()
);
alter table public.photo_session_deletions enable row level security;
revoke all on public.photo_session_deletions from public, anon, authenticated;
grant all on public.photo_session_deletions to service_role;

create function public.delete_photo_session(p_session_id uuid, p_participant_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare room public.photo_sessions;
begin
  select * into room from photo_sessions where id = p_session_id for update;
  if room.id is null then raise exception 'Session expired'; end if;
  if room.owner_participant_id is distinct from p_participant_id then
    raise exception 'Forbidden';
  end if;
  if exists (select 1 from photo_session_deletions where session_id = room.id) then return; end if;
  if room.expires_at <= now() then raise exception 'Session expired'; end if;
  insert into photo_session_deletions (invite_token, session_id) values (room.invite_token, room.id);
  -- Use a past timestamp: now() in a waiting transaction predates this deletion.
  -- Existing locked mutations and worker completion already enforce expires_at.
  update photo_sessions set expires_at = least(expires_at, '1970-01-01T00:00:00Z'::timestamptz),
    version = version + 1 where id = room.id;
end;
$$;
revoke all on function public.delete_photo_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_photo_session(uuid, uuid) to service_role;
