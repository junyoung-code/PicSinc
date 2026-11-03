-- Restore the original merge workflow for new rooms. Existing collaborative
-- rooms, their edits and their authorization guards remain unchanged.
create or replace function public.enqueue_original_detection() returns trigger
language plpgsql security invoker set search_path=public as $$
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

revoke all on function public.enqueue_original_detection() from public,anon,authenticated;
grant execute on function public.enqueue_original_detection() to service_role;
