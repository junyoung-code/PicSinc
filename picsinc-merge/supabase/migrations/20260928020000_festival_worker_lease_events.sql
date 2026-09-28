-- Record worker attempts that end without a worker response (lease loss or stale version).
begin;
create function public.festival_worker_lease_event() returns trigger
language plpgsql security invoker set search_path = public as $$
declare context_name text;
begin
  if old.status <> 'running' then return null; end if;
  if new.attempts <= old.attempts and not (new.status = 'failed' and new.error_code in ('worker_lost', 'version_changed')) then
    return null;
  end if;
  select event_context into context_name from festival_analytics_room_contexts where session_id = old.session_id;
  if context_name is null then return null; end if;
  insert into festival_analytics_events(event_name,event_context,session_id,processing_job_id,attempt,error_code)
  values ('worker_attempt_finished',context_name,old.session_id,old.id,old.attempts,
    case when new.error_code = 'version_changed' then 'version_changed' else 'worker_lost' end)
  on conflict do nothing;
  return null;
end;
$$;
create trigger festival_worker_lease_event after update on public.processing_jobs
for each row execute function public.festival_worker_lease_event();
commit;
