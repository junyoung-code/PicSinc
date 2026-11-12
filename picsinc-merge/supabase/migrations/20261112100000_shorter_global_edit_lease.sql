-- Whole-photo edit lease 90s -> 45s (B-022). An editor's app renews it every
-- 20 seconds, so active editing is unaffected; a friend who leaves with the
-- editor open now blocks others for at most 45 seconds instead of 90.
-- Safety: only rewrites collaboration_action when its body is exactly the one
-- from 20261014114539_collaborative_retouch_rooms.sql (line endings ignored).
-- If the deployed function differs, this stops with an error and changes nothing.
do $$
declare src text;
begin
 select prosrc into src from pg_proc where oid='public.collaboration_action(uuid,uuid,text,jsonb)'::regprocedure;
 if md5(replace(src,chr(13),''))<>'4d5853da217881512d93e6d2ebf202d7' then
  raise exception 'collaboration_action differs from the repository version; lease not changed';
 end if;
 execute format(
  'create or replace function public.collaboration_action(p_session_id uuid,p_participant_id uuid,p_action text,p_payload jsonb default %L) returns jsonb language plpgsql security invoker set search_path=public as %L',
  '{}', replace(src,'''90 seconds''','''45 seconds'''));
end $$;
