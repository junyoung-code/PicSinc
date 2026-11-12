-- A participant can leave a collaborative room while it is still in the lobby.
-- Their row (and credentials) is removed so the owner's list and the roster
-- frozen by "start" no longer include them. After "start" the roster is fixed.
create function public.leave_retouch_room(p_session_id uuid,p_participant_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare s photo_sessions; c session_collaboration;
begin
 select * into s from photo_sessions where id=p_session_id for update;
 if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
 -- A retry after a lost response finds the participant already gone.
 if not exists(select 1 from participants where session_id=s.id and id=p_participant_id) then return; end if;
 if s.owner_participant_id=p_participant_id then raise exception 'Forbidden'; end if;
 select * into c from session_collaboration where session_id=s.id for update;
 if c.session_id is null then raise exception 'Retouch room required'; end if;
 if c.phase<>'lobby' then raise exception 'Collaboration locked'; end if;
 delete from participants where id=p_participant_id and session_id=s.id;
 -- Clients poll the session version, so the owner's lobby sees the change.
 update photo_sessions set version=version+1 where id=s.id;
end; $$;
revoke all on function public.leave_retouch_room(uuid,uuid) from public,anon,authenticated;
grant execute on function public.leave_retouch_room(uuid,uuid) to service_role;
