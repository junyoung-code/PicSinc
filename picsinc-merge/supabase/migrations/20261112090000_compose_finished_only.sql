-- The owner can compose with only the participants who finished their personal
-- edit, so one absent friend no longer blocks the room (B-028). Unfinished
-- people leave the roster: their face stays original in the composition, and
-- they can still join the whole-photo touch step that follows.
create function public.compose_finished_only(p_session_id uuid,p_participant_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s photo_sessions; c session_collaboration; finished uuid[];
begin
 select * into s from photo_sessions where id=p_session_id for update;
 if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
 if s.owner_participant_id is distinct from p_participant_id then raise exception 'Forbidden'; end if;
 select * into c from session_collaboration where session_id=s.id for update;
 if c.session_id is null then raise exception 'Collaboration required'; end if;
 if c.phase<>'personal' then raise exception 'Collaboration locked'; end if;
 finished:=array(select u.r from unnest(c.roster_ids) with ordinality as u(r,n)
  where exists(select 1 from personal_edits e where e.participant_id=u.r and e.done) order by u.n);
 if cardinality(finished)=0 then raise exception 'Nobody finished'; end if;
 update session_collaboration set roster_ids=finished where session_id=s.id;
 -- Close open personal editors so a late save cannot change the composed room.
 update personal_edits set edit_token=null where session_id=s.id and not done;
 return collaboration_action(s.id,p_participant_id,'compose','{}'::jsonb);
end; $$;
revoke all on function public.compose_finished_only(uuid,uuid) from public,anon,authenticated;
grant execute on function public.compose_finished_only(uuid,uuid) to service_role;
