-- Match the shared browser/server 30MP limit; keep the 8192px side limit and permissions.
create or replace function public.enqueue_original_detection() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.kind='original' then
  if exists(select 1 from photo_upload_intents u
    where u.session_id=new.session_id and u.asset_id=new.id and u.kind='original'
      and u.retouch_room and u.status='verifying') then
   if new.width::bigint*new.height>30000000 or greatest(new.width,new.height)>8192 then
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
