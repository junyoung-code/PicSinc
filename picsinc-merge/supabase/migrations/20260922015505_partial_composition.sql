-- A room may publish a result as soon as at least one participant has submitted.
-- Keep the existing RPC signature, owner/version/expiry checks, and service-only access.
create or replace function public.publish_composition(p_result jsonb, p_assets jsonb, p_participant_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare s photo_sessions; a jsonb;
begin
  select * into s from photo_sessions where id=(p_result->>'sessionId')::uuid for update;
  if s.id is null or s.owner_participant_id is distinct from p_participant_id or s.version<>(p_result->>'version')::integer or s.expires_at<=now() then return false; end if;
  if not exists(select 1 from participants where session_id=s.id and submitted) then return false; end if;
  if exists(select 1 from composition_results where session_id=s.id and version=s.version) then return false; end if;
  for a in select * from jsonb_array_elements(p_assets) loop
    if (a->>'sessionId')::uuid<>s.id or a->>'kind' not in ('preview','result') then raise exception 'Invalid result asset'; end if;
    insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type)
    values((a->>'id')::uuid,s.id,null,a->>'kind',a->>'storageKey',(a->>'width')::integer,(a->>'height')::integer,'image/png');
  end loop;
  insert into composition_results values(s.id,s.version,(p_result->>'previewAssetId')::uuid,(p_result->>'resultAssetId')::uuid,(p_result->>'width')::integer,(p_result->>'height')::integer,(p_result->>'unassignedOverlapPixels')::bigint);
  return true;
end; $$;

revoke all on function public.publish_composition(jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.publish_composition(jsonb,jsonb,uuid) to service_role;
