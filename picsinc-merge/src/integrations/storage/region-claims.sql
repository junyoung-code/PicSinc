-- Main applies this draft as one migration before the new claim API is deployed.
begin;
lock table public.photo_sessions in share row exclusive mode;

create table public.region_claims (
  session_id uuid not null references public.photo_sessions(id) on delete cascade,
  region_id text not null check (length(region_id) between 1 and 80),
  participant_id uuid not null references public.participants(id) on delete cascade,
  primary key (session_id, region_id)
);
create index region_claims_participant on public.region_claims(participant_id);
alter table public.region_claims enable row level security;
revoke all on public.region_claims from public, anon, authenticated;
grant all on public.region_claims to service_role;

-- Existing saved selections have no click timestamps. Retain one deterministic
-- owner per ID without rewriting saved masks or changing historical composition.
insert into public.region_claims(session_id, region_id, participant_id)
select distinct on (o.session_id, region_id) o.session_id, region_id, o.participant_id
from public.original_selections o
cross join lateral unnest(o.selected_region_ids) as selected(region_id)
where length(region_id) between 1 and 80
order by o.session_id, region_id, o.participant_id;

create function public.list_region_claims(p_session_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('regionId', c.region_id,
    'participantId', c.participant_id, 'nickname', p.nickname) order by c.region_id), '[]'::jsonb)
  from region_claims c join participants p on p.id = c.participant_id and p.session_id = c.session_id
  join photo_sessions s on s.id = c.session_id and s.expires_at > now()
  where c.session_id = p_session_id;
$$;

create function public.set_region_claim(p_session_id uuid, p_participant_id uuid, p_region_id text, p_selected boolean) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare s photo_sessions; current_claim jsonb;
begin
  -- The same room lock is taken by mask saves. Ownership cannot change between
  -- their ownership check and write, and simultaneous clicks have one winner.
  select * into s from photo_sessions where id = p_session_id for update;
  if s.id is null or s.expires_at <= now() then raise exception 'Session expired'; end if;
  if not exists(select 1 from participants where id = p_participant_id and session_id = s.id) then raise exception 'Forbidden'; end if;
  if p_selected is null or p_region_id is null or not exists(
    select 1 from original_detections d cross join lateral jsonb_array_elements(d.detection->'regions') r
    where d.session_id = s.id and r->>'id' = p_region_id
  ) then raise exception 'Invalid region'; end if;

  select jsonb_build_object('regionId', c.region_id, 'participantId', c.participant_id, 'nickname', p.nickname)
  into current_claim from region_claims c join participants p on p.id = c.participant_id
  where c.session_id = s.id and c.region_id = p_region_id;
  if current_claim is not null and (current_claim->>'participantId')::uuid <> p_participant_id then
    return jsonb_build_object('conflict', current_claim, 'claims', list_region_claims(s.id));
  end if;
  if p_selected then
    insert into region_claims(session_id, region_id, participant_id) values(s.id, p_region_id, p_participant_id)
    on conflict(session_id, region_id) do nothing;
  else
    delete from region_claims where session_id = s.id and region_id = p_region_id and participant_id = p_participant_id;
  end if;
  -- Draft clicks do not bump the composition version or replace saved masks.
  return jsonb_build_object('claims', list_region_claims(s.id));
end;
$$;

create or replace function public.replace_original_selection(p_session_id uuid, p_participant_id uuid, p_mask_asset_id uuid, p_selected_region_ids text[], p_expected_version integer) returns integer
language plpgsql security invoker set search_path = public as $$
declare next_version integer; conflicting_claim jsonb;
begin
  update photo_sessions set version = version + 1 where id = p_session_id and version = p_expected_version and expires_at > now() returning version into next_version;
  if next_version is null then return null; end if;
  if not exists(select 1 from photo_assets m join participants p on p.id = m.participant_id where m.id = p_mask_asset_id and m.session_id = p_session_id and m.participant_id = p_participant_id and m.kind = 'mask' and p.session_id = p_session_id) then raise exception 'Invalid original mask'; end if;

  select jsonb_build_object('regionId', c.region_id, 'participantId', c.participant_id, 'nickname', p.nickname)
  into conflicting_claim from region_claims c join participants p on p.id = c.participant_id
  where c.session_id = p_session_id and c.region_id = any(p_selected_region_ids) and c.participant_id <> p_participant_id
  order by c.region_id limit 1;
  if conflicting_claim is not null then raise exception 'Region claim conflict' using detail = conflicting_claim::text; end if;
  if exists(select 1 from unnest(p_selected_region_ids) as selected(region_id) where not exists(
    select 1 from region_claims c where c.session_id = p_session_id and c.region_id = selected.region_id and c.participant_id = p_participant_id
  )) then raise exception 'Region claim required'; end if;

  insert into original_selections(participant_id, session_id, mask_asset_id, selected_region_ids)
  values(p_participant_id, p_session_id, p_mask_asset_id, p_selected_region_ids)
  on conflict(participant_id) do update set mask_asset_id = excluded.mask_asset_id, selected_region_ids = excluded.selected_region_ids;
  update participants set submitted = false where id = p_participant_id and session_id = p_session_id;
  return next_version;
end;
$$;

revoke all on function public.list_region_claims(uuid), public.set_region_claim(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.list_region_claims(uuid), public.set_region_claim(uuid, uuid, text, boolean) to service_role;
commit;
