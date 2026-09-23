-- Draft for main review. Apply atomically after old active rooms expire.
-- Existing expired rooms and private files remain available to scheduled cleanup.
begin;
lock table public.photo_sessions in access exclusive mode;
do $$ begin
  if exists (select 1 from public.photo_sessions where expires_at > now()) then
    raise exception 'Wait until all existing rooms expire before applying mobile flow';
  end if;
end $$;

alter table public.photo_sessions add column owner_participant_id uuid references public.participants(id) deferrable initially deferred;
alter table public.participants add column submitted boolean not null default false;
create table public.original_selections (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  session_id uuid not null references public.photo_sessions(id) on delete cascade,
  mask_asset_id uuid not null references public.photo_assets(id),
  selected_region_ids text[] not null default '{}'
);
create index original_selections_session on public.original_selections(session_id);
create table public.original_detections (
  session_id uuid primary key references public.photo_sessions(id) on delete cascade,
  detection jsonb not null
);
alter table public.original_selections enable row level security;
alter table public.original_detections enable row level security;
revoke all on public.original_selections, public.original_detections from public, anon, authenticated;
grant all on public.original_selections, public.original_detections to service_role;

create or replace function public.create_photo_session(p_session_id uuid, p_invite_token text, p_original_asset_id uuid, p_created_at timestamptz, p_expires_at timestamptz, p_participant_id uuid, p_nickname text, p_session_token_hash text, p_recovery_token_hash text, p_storage_key text, p_width integer, p_height integer, p_content_type text) returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into photo_sessions (id, invite_token, original_asset_id, owner_participant_id, created_at, expires_at) values (p_session_id, p_invite_token, p_original_asset_id, p_participant_id, p_created_at, p_expires_at);
  insert into participants (id, session_id, nickname) values (p_participant_id, p_session_id, p_nickname);
  insert into participant_credentials values (p_participant_id, p_session_id, p_session_token_hash, p_recovery_token_hash);
  insert into photo_assets (id, session_id, participant_id, kind, storage_key, width, height, content_type) values (p_original_asset_id, p_session_id, null, 'original', p_storage_key, p_width, p_height, p_content_type);
end; $$;

create function public.join_photo_session(p_session_id uuid, p_participant_id uuid, p_nickname text, p_session_token_hash text, p_recovery_token_hash text) returns void language plpgsql security invoker set search_path = public as $$
begin
  update photo_sessions set version = version + 1 where id = p_session_id and expires_at > now() and owner_participant_id is not null;
  if not found then raise exception 'Session expired'; end if;
  insert into participants(id, session_id, nickname) values(p_participant_id, p_session_id, p_nickname);
  insert into participant_credentials values(p_participant_id, p_session_id, p_session_token_hash, p_recovery_token_hash);
end; $$;

create function public.register_photo_asset(p_asset jsonb) returns jsonb language plpgsql security invoker set search_path = public as $$
declare s photo_sessions; original photo_assets; a photo_assets;
begin
  select * into s from photo_sessions where id=(p_asset->>'sessionId')::uuid for update;
  if s.id is null or s.expires_at <= now() then raise exception 'Session expired'; end if;
  if not exists(select 1 from participants where id=(p_asset->>'participantId')::uuid and session_id=s.id) or p_asset->>'kind' not in ('edited','mask') then raise exception 'Invalid asset owner'; end if;
  select * into original from photo_assets where id=s.original_asset_id;
  if original.width <> (p_asset->>'width')::integer or original.height <> (p_asset->>'height')::integer then raise exception 'Invalid asset dimensions'; end if;
  insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type)
  values((p_asset->>'id')::uuid,s.id,(p_asset->>'participantId')::uuid,p_asset->>'kind',p_asset->>'storageKey',(p_asset->>'width')::integer,(p_asset->>'height')::integer,p_asset->>'contentType') returning * into a;
  if a.kind='edited' then
    update participants set submitted=false where id=a.participant_id;
    update photo_sessions set version=version+1 where id=s.id;
  end if;
  return to_jsonb(a);
end; $$;

create function public.replace_original_selection(p_session_id uuid, p_participant_id uuid, p_mask_asset_id uuid, p_selected_region_ids text[], p_expected_version integer) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version=version+1 where id=p_session_id and version=p_expected_version and expires_at>now() returning version into next_version;
  if next_version is null then return null; end if;
  if not exists(select 1 from photo_assets m join participants p on p.id=m.participant_id where m.id=p_mask_asset_id and m.session_id=p_session_id and m.participant_id=p_participant_id and m.kind='mask' and p.session_id=p_session_id) then raise exception 'Invalid original mask'; end if;
  insert into original_selections(participant_id,session_id,mask_asset_id,selected_region_ids) values(p_participant_id,p_session_id,p_mask_asset_id,p_selected_region_ids)
  on conflict(participant_id) do update set mask_asset_id=excluded.mask_asset_id, selected_region_ids=excluded.selected_region_ids;
  update participants set submitted=false where id=p_participant_id and session_id=p_session_id;
  return next_version;
end; $$;

-- Drop old signatures to prevent bypassing the new submission and owner checks.
drop function public.replace_selection(uuid,uuid,uuid,uuid,integer);
create function public.replace_selection(p_session_id uuid, p_participant_id uuid, p_edited_asset_id uuid, p_mask_asset_id uuid, p_expected_version integer, p_submitted boolean) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version=version+1 where id=p_session_id and version=p_expected_version and expires_at>now() returning version into next_version;
  if next_version is null then return null; end if;
  if not exists(select 1 from original_selections where participant_id=p_participant_id and session_id=p_session_id) then raise exception 'Original selection required'; end if;
  if not exists(select 1 from photo_assets where id=p_edited_asset_id and session_id=p_session_id and participant_id=p_participant_id and kind='edited') or not exists(select 1 from photo_assets where id=p_mask_asset_id and session_id=p_session_id and participant_id=p_participant_id and kind='mask') then raise exception 'Invalid selection assets'; end if;
  insert into selections(participant_id,session_id,edited_asset_id,mask_asset_id) values(p_participant_id,p_session_id,p_edited_asset_id,p_mask_asset_id)
  on conflict(participant_id,edited_asset_id) do update set mask_asset_id=excluded.mask_asset_id;
  update participants set submitted=p_submitted where id=p_participant_id and session_id=p_session_id;
  return next_version;
end; $$;

drop function public.replace_overlap_assignments(uuid,jsonb,integer);
create function public.replace_overlap_assignments(p_session_id uuid, p_participant_id uuid, p_assignments jsonb, p_expected_version integer) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer; a jsonb;
begin
  update photo_sessions set version=version+1 where id=p_session_id and owner_participant_id=p_participant_id and version=p_expected_version and expires_at>now() returning version into next_version;
  if next_version is null then return null; end if;
  for a in select * from jsonb_array_elements(p_assignments) loop
    if not exists(select 1 from photo_assets where id=(a->>'edited_asset_id')::uuid and session_id=p_session_id and kind='edited') or not exists(select 1 from photo_assets where id=(a->>'mask_asset_id')::uuid and session_id=p_session_id and kind='mask') then raise exception 'Invalid overlap assets'; end if;
  end loop;
  delete from overlap_assignments where session_id=p_session_id;
  insert into overlap_assignments(session_id,edited_asset_id,mask_asset_id) select p_session_id,(entry.value->>'edited_asset_id')::uuid,(entry.value->>'mask_asset_id')::uuid from jsonb_array_elements(p_assignments) as entry(value);
  return next_version;
end; $$;

create function public.cache_original_detection(p_session_id uuid, p_detection jsonb) returns jsonb language plpgsql security invoker set search_path = public as $$
declare s photo_sessions; result jsonb;
begin
  select * into s from photo_sessions where id=p_session_id for update;
  if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
  insert into original_detections(session_id,detection) values(p_session_id,p_detection) on conflict(session_id) do nothing;
  select detection into result from original_detections where session_id=p_session_id;
  return result;
end; $$;

create or replace function public.photo_session_snapshot(p_session_id uuid) returns jsonb language sql stable security invoker set search_path = public as $$
 select jsonb_build_object(
 'session',to_jsonb(s),
 'participants',coalesce((select jsonb_agg(p order by p.id) from participants p where p.session_id=s.id),'[]'::jsonb),
 'assets',coalesce((select jsonb_agg(a order by a.id) from photo_assets a where a.session_id=s.id),'[]'::jsonb),
 'original_selections',coalesce((select jsonb_agg(o order by o.participant_id) from original_selections o where o.session_id=s.id),'[]'::jsonb),
 'selections',coalesce((select jsonb_agg(c order by c.participant_id,c.edited_asset_id) from selections c where c.session_id=s.id),'[]'::jsonb),
 'overlaps',coalesce((select jsonb_agg(o order by o.edited_asset_id) from overlap_assignments o where o.session_id=s.id),'[]'::jsonb),
 'result',(select jsonb_build_object('sessionId',r.session_id,'version',r.version,'previewAssetId',r.preview_asset_id,'resultAssetId',r.result_asset_id,'width',r.width,'height',r.height,'unassignedOverlapPixels',r.unassigned_overlap_pixels) from composition_results r where r.session_id=s.id order by r.version desc limit 1)
 ) from photo_sessions s where s.id=p_session_id;
$$;

drop function public.publish_composition(jsonb,jsonb);
create function public.publish_composition(p_result jsonb, p_assets jsonb, p_participant_id uuid) returns boolean language plpgsql security invoker set search_path = public as $$
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

-- Only the trusted Next.js service role may access these invoker RPCs.
revoke all on function public.join_photo_session(uuid,uuid,text,text,text), public.register_photo_asset(jsonb), public.replace_original_selection(uuid,uuid,uuid,text[],integer), public.replace_selection(uuid,uuid,uuid,uuid,integer,boolean), public.replace_overlap_assignments(uuid,uuid,jsonb,integer), public.cache_original_detection(uuid,jsonb), public.publish_composition(jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.join_photo_session(uuid,uuid,text,text,text), public.register_photo_asset(jsonb), public.replace_original_selection(uuid,uuid,uuid,text[],integer), public.replace_selection(uuid,uuid,uuid,uuid,integer,boolean), public.replace_overlap_assignments(uuid,uuid,jsonb,integer), public.cache_original_detection(uuid,jsonb), public.publish_composition(jsonb,jsonb,uuid) to service_role;
commit;
