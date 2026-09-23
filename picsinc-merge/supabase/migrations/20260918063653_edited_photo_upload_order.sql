-- Additive change: retain all existing rooms, credentials, selections and files.
begin;
-- Match the session -> asset lock order used by uploads and composition.
lock table public.photo_sessions in share row exclusive mode;
alter table public.photo_assets add column upload_order integer;

-- Historical upload times were not stored. Freeze the previous UUID ordering.
with existing as (
  select id, row_number() over (partition by session_id order by id)::integer as position
  from public.photo_assets where kind='edited'
)
update public.photo_assets a set upload_order=e.position from existing e where a.id=e.id;

alter table public.photo_assets add constraint photo_assets_upload_order_kind check (
  (kind='edited' and upload_order is not null and upload_order>0)
  or (kind<>'edited' and upload_order is null)
);
create unique index photo_assets_upload_order on public.photo_assets(session_id,upload_order)
where upload_order is not null;

create or replace function public.register_photo_asset(p_asset jsonb) returns jsonb language plpgsql security invoker set search_path = public as $$
declare s photo_sessions; original photo_assets; a photo_assets; next_order integer;
begin
  select * into s from photo_sessions where id=(p_asset->>'sessionId')::uuid for update;
  if s.id is null or s.expires_at <= now() then raise exception 'Session expired'; end if;
  if not exists(select 1 from participants where id=(p_asset->>'participantId')::uuid and session_id=s.id) or p_asset->>'kind' not in ('edited','mask') then raise exception 'Invalid asset owner'; end if;
  select * into original from photo_assets where id=s.original_asset_id;
  if original.width <> (p_asset->>'width')::integer or original.height <> (p_asset->>'height')::integer then raise exception 'Invalid asset dimensions'; end if;
  -- The existing session row lock serializes successful registrations in this room.
  -- Ignore any client-provided order; masks never consume a position.
  if p_asset->>'kind'='edited' then
    select coalesce(max(upload_order),0)+1 into next_order from photo_assets where session_id=s.id;
  end if;
  insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type,upload_order)
  values((p_asset->>'id')::uuid,s.id,(p_asset->>'participantId')::uuid,p_asset->>'kind',p_asset->>'storageKey',(p_asset->>'width')::integer,(p_asset->>'height')::integer,p_asset->>'contentType',next_order) returning * into a;
  if a.kind='edited' then
    update participants set submitted=false where id=a.participant_id;
    update photo_sessions set version=version+1 where id=s.id;
  end if;
  return to_jsonb(a);
end; $$;

create or replace function public.photo_session_snapshot(p_session_id uuid) returns jsonb language sql stable security invoker set search_path = public as $$
 select jsonb_build_object(
 'session',to_jsonb(s),
 'participants',coalesce((select jsonb_agg(p order by p.id) from participants p where p.session_id=s.id),'[]'::jsonb),
 'assets',coalesce((select jsonb_agg(a order by a.upload_order nulls last,a.id) from photo_assets a where a.session_id=s.id),'[]'::jsonb),
 'original_selections',coalesce((select jsonb_agg(o order by o.participant_id) from original_selections o where o.session_id=s.id),'[]'::jsonb),
 'selections',coalesce((select jsonb_agg(c order by c.participant_id,c.edited_asset_id) from selections c where c.session_id=s.id),'[]'::jsonb),
 'overlaps',coalesce((select jsonb_agg(o order by o.edited_asset_id) from overlap_assignments o where o.session_id=s.id),'[]'::jsonb),
 'result',(select jsonb_build_object('sessionId',r.session_id,'version',r.version,'previewAssetId',r.preview_asset_id,'resultAssetId',r.result_asset_id,'width',r.width,'height',r.height,'unassignedOverlapPixels',r.unassigned_overlap_pixels) from composition_results r where r.session_id=s.id order by r.version desc limit 1)
 ) from photo_sessions s where s.id=p_session_id;
$$;

-- CREATE OR REPLACE preserves the existing service-role-only invoker permissions.
commit;
