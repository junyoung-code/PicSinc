-- Draft for main's review/application only. Requires the existing collaboration
-- schema/functions and restore_merge_room_default; do not reapply the historic
-- collaboration.sql automatic-enablement trigger to a live database.
alter table public.photo_upload_intents
  add column retouch_room boolean not null default false,
  add constraint retouch_original_only check (not retouch_room or kind = 'original');

-- create_photo_session inserts the original while finalize_original_upload holds
-- the intent lock. No detection job is ever visible for a retouch lobby.
create or replace function public.enqueue_original_detection() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.kind='original' then
  if exists(select 1 from photo_upload_intents u
    where u.session_id=new.session_id and u.asset_id=new.id and u.kind='original'
      and u.retouch_room and u.status='verifying') then
   if new.width::bigint*new.height>16000000 or greatest(new.width,new.height)>8192 then
    raise exception 'Retouch image too large';
   end if;
   insert into session_collaboration(session_id) values(new.session_id);
  else
   insert into processing_jobs(session_id,requested_by,kind,dedupe_key,input)
   select new.session_id,s.owner_participant_id,'detect','detect:'||new.id,
     jsonb_build_object('assetId',new.id,'width',new.width,'height',new.height)
   from photo_sessions s where s.id=new.session_id
   on conflict(dedupe_key) do nothing;
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.enqueue_original_detection() from public,anon,authenticated;
grant execute on function public.enqueue_original_detection() to service_role;

-- Check room kind and create membership under the same room lock used by start,
-- expiry and deletion. A separate preflight followed by join would allow a race.
create function public.join_retouch_room(p_session_id uuid,p_participant_id uuid,p_nickname text,p_session_token_hash text,p_recovery_token_hash text)
returns void language plpgsql security invoker set search_path=public as $$
declare s photo_sessions;
begin
 select * into s from photo_sessions where id=p_session_id for update;
 if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
 perform 1 from session_collaboration where session_id=s.id for update;
 if not found then raise exception 'Retouch room required'; end if;
 perform join_photo_session(s.id,p_participant_id,p_nickname,p_session_token_hash,p_recovery_token_hash);
end; $$;
revoke all on function public.join_retouch_room(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.join_retouch_room(uuid,uuid,text,text,text) to service_role;
