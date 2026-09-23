-- Applied by main to the dedicated project; versioned results and one-statement snapshots.
create table public.composition_results (
 session_id uuid not null references public.photo_sessions(id) on delete cascade,
 version integer not null,
 preview_asset_id uuid not null references public.photo_assets(id),
 result_asset_id uuid not null references public.photo_assets(id),
 width integer not null, height integer not null, unassigned_overlap_pixels bigint not null,
 primary key (session_id, version)
);
alter table public.composition_results enable row level security;
revoke all on public.composition_results from public, anon, authenticated;
grant all on public.composition_results to service_role;

create function public.photo_session_snapshot(p_session_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
 select jsonb_build_object(
 'session', to_jsonb(s),
 'participants', coalesce((select jsonb_agg(p order by p.id) from participants p where p.session_id=s.id),'[]'::jsonb),
 'assets', coalesce((select jsonb_agg(a order by a.id) from photo_assets a where a.session_id=s.id),'[]'::jsonb),
 'selections', coalesce((select jsonb_agg(c order by c.participant_id) from selections c where c.session_id=s.id),'[]'::jsonb),
 'overlaps', coalesce((select jsonb_agg(o order by o.edited_asset_id) from overlap_assignments o where o.session_id=s.id),'[]'::jsonb),
 'result', (select jsonb_build_object('sessionId',r.session_id,'version',r.version,'previewAssetId',r.preview_asset_id,'resultAssetId',r.result_asset_id,'width',r.width,'height',r.height,'unassignedOverlapPixels',r.unassigned_overlap_pixels) from composition_results r where r.session_id=s.id order by r.version desc limit 1)
 ) from photo_sessions s where s.id=p_session_id;
$$;

create function public.publish_composition(p_result jsonb, p_assets jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare s photo_sessions; a jsonb;
begin
 select * into s from photo_sessions where id=(p_result->>'sessionId')::uuid for update;
 if s.id is null or s.version <> (p_result->>'version')::integer or s.expires_at <= now() then return false; end if;
 if exists(select 1 from composition_results where session_id=s.id and version=s.version) then return false; end if;
 for a in select * from jsonb_array_elements(p_assets) loop
   if (a->>'sessionId')::uuid <> s.id or a->>'kind' not in ('preview','result') then raise exception 'Invalid result asset'; end if;
   insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type)
   values ((a->>'id')::uuid,s.id,null,a->>'kind',a->>'storageKey',(a->>'width')::integer,(a->>'height')::integer,'image/png');
 end loop;
 insert into composition_results values(s.id,s.version,(p_result->>'previewAssetId')::uuid,(p_result->>'resultAssetId')::uuid,(p_result->>'width')::integer,(p_result->>'height')::integer,(p_result->>'unassignedOverlapPixels')::bigint);
 return true;
end; $$;
revoke all on function public.photo_session_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.publish_composition(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.photo_session_snapshot(uuid) to service_role;
grant execute on function public.publish_composition(jsonb,jsonb) to service_role;
create index photo_sessions_expiry on public.photo_sessions(expires_at);
create index photo_assets_session on public.photo_assets(session_id);
create index selections_session on public.selections(session_id);
create index participants_session on public.participants(session_id);

create or replace function public.replace_selection(p_session_id uuid, p_participant_id uuid, p_edited_asset_id uuid, p_mask_asset_id uuid, p_expected_version integer) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version = version + 1 where id = p_session_id and version = p_expected_version and expires_at > now() returning version into next_version;
  if next_version is null then return null; end if;
  insert into selections (participant_id, session_id, edited_asset_id, mask_asset_id) values (p_participant_id, p_session_id, p_edited_asset_id, p_mask_asset_id) on conflict (participant_id) do update set edited_asset_id = excluded.edited_asset_id, mask_asset_id = excluded.mask_asset_id;
  return next_version;
end; $$;

create or replace function public.replace_overlap_assignments(p_session_id uuid, p_assignments jsonb, p_expected_version integer) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version = version + 1 where id = p_session_id and version = p_expected_version and expires_at > now() returning version into next_version;
  if next_version is null then return null; end if;
  delete from overlap_assignments where session_id = p_session_id;
  insert into overlap_assignments (session_id, edited_asset_id, mask_asset_id) select p_session_id, (item->>'edited_asset_id')::uuid, (item->>'mask_asset_id')::uuid from jsonb_array_elements(p_assignments) item;
  return next_version;
end; $$;

