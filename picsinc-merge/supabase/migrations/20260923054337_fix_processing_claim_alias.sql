create or replace function public.claim_processing_job() returns jsonb language plpgsql security invoker set search_path=public as $$
declare j processing_jobs;
begin
 update processing_jobs set status='failed',error_code='worker_lost',error_message='처리가 중단됐어요. 다시 시도해 주세요.',updated_at=now()
 where status='running' and lease_until<=now() and attempts>=3;
 update processing_jobs stale set status='failed',error_code='version_changed',error_message='사진이나 선택이 바뀌었어요. 다시 병합해 주세요.',updated_at=now()
 from photo_sessions s where s.id=stale.session_id and stale.kind='compose' and stale.status in ('queued','running') and s.version<>(stale.input->>'version')::integer;
 select q.* into j from processing_jobs q join photo_sessions s on s.id=q.session_id
 where s.expires_at>now() and q.attempts<3 and ((q.status='queued' and q.available_at<=now()) or (q.status='running' and q.lease_until<=now()))
 order by q.created_at,q.id limit 1 for update of q skip locked;
 if j.id is null then return null; end if;
 update processing_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',updated_at=now(),error_code=null,error_message=null where id=j.id returning * into j;
 return to_jsonb(j);
end; $$;
