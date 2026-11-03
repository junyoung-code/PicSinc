-- Service-only collaborative editing. Existing rooms remain legacy; new rooms start in lobby.
create table public.session_collaboration (
 session_id uuid primary key references public.photo_sessions(id) on delete cascade,
 phase text not null default 'lobby' check (phase in ('lobby','personal','composing','global','review','final')),
 roster_ids uuid[] not null default '{}',
 editor_id uuid references public.participants(id), edit_token uuid, lease_until timestamptz,
 version integer not null default 0, latest_asset_id uuid references public.photo_assets(id)
);
create table public.personal_edits (
 session_id uuid not null references public.photo_sessions(id) on delete cascade,
 participant_id uuid primary key references public.participants(id) on delete cascade,
 edit_token uuid, mask_asset_id uuid references public.photo_assets(id),
 selected_region_ids text[] not null default '{}', state jsonb, done boolean not null default false
);
create table public.global_edit_history (
 session_id uuid not null references public.photo_sessions(id) on delete cascade,
 version integer not null, participant_id uuid not null references public.participants(id),
 asset_id uuid not null references public.photo_assets(id), state jsonb not null, created_at timestamptz not null default now(),
 primary key(session_id,version)
);
create table public.collaboration_save_receipts (
 session_id uuid not null references public.photo_sessions(id) on delete cascade,
 participant_id uuid not null references public.participants(id) on delete cascade,
 edit_token uuid not null, source_asset_id uuid not null references public.photo_assets(id),
 action text not null check(action in ('personal-save','save')),
 primary key(participant_id,edit_token)
);
alter table public.collaboration_save_receipts enable row level security;
revoke all on public.collaboration_save_receipts from public,anon,authenticated;
grant all on public.collaboration_save_receipts to service_role;
alter table public.session_collaboration enable row level security;
alter table public.personal_edits enable row level security;
alter table public.global_edit_history enable row level security;
revoke all on public.session_collaboration, public.personal_edits, public.global_edit_history from public,anon,authenticated;
grant all on public.session_collaboration, public.personal_edits, public.global_edit_history to service_role;

create or replace function public.enqueue_original_detection() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.kind='original' then
  insert into session_collaboration(session_id) values(new.session_id) on conflict do nothing;
 end if;
 return new;
end; $$;

create function public.collaboration_view(p_session_id uuid,p_participant_id uuid) returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('enabled',true,'phase',c.phase,'rosterIds',to_jsonb(c.roster_ids),
 'completedIds',coalesce((select jsonb_agg(participant_id order by participant_id) from personal_edits where session_id=c.session_id and done),'[]'::jsonb),
 'personalToken',(select edit_token from personal_edits where session_id=c.session_id and participant_id=p_participant_id),
 'personalMaskAssetId',(select mask_asset_id from personal_edits where session_id=c.session_id and participant_id=p_participant_id),
 'personalState',null,
 'editorId',case when c.lease_until>now() then c.editor_id end,'leaseUntil',case when c.lease_until>now() then c.lease_until end,
 'editToken',case when c.editor_id=p_participant_id and c.lease_until>now() then c.edit_token end,
 'version',c.version,'latestAssetId',c.latest_asset_id,
 'history',coalesce((select jsonb_agg(jsonb_build_object('version',h.version,'participantId',h.participant_id,'assetId',h.asset_id,'createdAt',h.created_at) order by h.version) from global_edit_history h where h.session_id=c.session_id),'[]'::jsonb))
 from session_collaboration c where c.session_id=p_session_id;
$$;

-- Every legacy mutation acquires the same room lock before deciding if it is allowed.
create function public.collaboration_guard(p_session_id uuid,p_participant_id uuid,p_operation text) returns void language plpgsql security invoker set search_path=public as $$
declare c session_collaboration;
begin
 perform 1 from photo_sessions where id=p_session_id for update;
 select * into c from session_collaboration where session_id=p_session_id;
 if c.session_id is null then return; end if;
 if p_operation='join' and c.phase='lobby' then return; end if;
 if p_operation='detect' and c.phase='personal' then return; end if;
 if p_operation='compose' and c.phase='composing' then return; end if;
 if p_operation='upload' then
  if c.phase='personal' and p_participant_id=any(c.roster_ids) and not exists(select 1 from personal_edits where participant_id=p_participant_id and done) then return; end if;
  if c.phase='global' and c.editor_id=p_participant_id and c.lease_until>now() then return; end if;
 end if;
 if p_operation='selection' and c.phase='personal' and p_participant_id=any(c.roster_ids)
 and not exists(select 1 from personal_edits where participant_id=p_participant_id and (done or edit_token is not null)) then return; end if;
 raise exception 'Collaboration locked';
end; $$;

create function public.collaboration_action(p_session_id uuid,p_participant_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path=public as $$
declare s photo_sessions; c session_collaboration; e personal_edits; o original_selections; a jsonb; j jsonb; asset_id uuid; mask_id uuid; next_order integer; receipt collaboration_save_receipts; receipt_action text;
begin
 select * into s from photo_sessions where id=p_session_id for update;
 if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
 if not exists(select 1 from participants where session_id=s.id and id=p_participant_id) then raise exception 'Forbidden'; end if;
 if p_action='enable' then
  if s.owner_participant_id<>p_participant_id then raise exception 'Forbidden'; end if;
  if not exists(select 1 from session_collaboration where session_id=s.id) then
   if exists(select 1 from original_selections where session_id=s.id) or exists(select 1 from composition_results where session_id=s.id) then raise exception 'Collaboration locked'; end if;
   insert into session_collaboration(session_id) values(s.id);
   delete from processing_jobs where session_id=s.id and kind='detect' and status='queued';
  end if;
 end if;
 select * into c from session_collaboration where session_id=s.id;
 if c.session_id is null then
  if p_action='read' then return jsonb_build_object('enabled',false,'phase','lobby','rosterIds','[]'::jsonb,'completedIds','[]'::jsonb,'version',0,'latestAssetId',null,'history','[]'::jsonb); end if;
  raise exception 'Collaboration required';
 end if;
 -- A retry after a lost HTTP response returns the committed state, even after
 -- later phase transitions. The same token cannot be used for a different file.
 if p_action in ('personal-save','save','receipt') then
  receipt_action:=case when p_action='receipt' then p_payload->>'action' else p_action end;
  select * into receipt from collaboration_save_receipts where session_id=s.id and participant_id=p_participant_id and edit_token::text=p_payload->>'token';
  if receipt.edit_token is not null then
   if receipt.action is distinct from receipt_action or receipt.source_asset_id::text is distinct from p_payload->>'editedAssetId' then raise exception 'Edit token expired'; end if;
   return collaboration_view(s.id,p_participant_id);
  end if;
  if p_action='receipt' then return null; end if;
 end if;
 if p_action in ('start','compose','open-global','end-global','finalize') and s.owner_participant_id<>p_participant_id then raise exception 'Forbidden'; end if;
 if p_action='start' then
  if c.phase<>'lobby' then raise exception 'Collaboration locked'; end if;
  update session_collaboration set phase='personal',roster_ids=array(select id from participants where session_id=s.id order by id) where session_id=s.id;
  j:=enqueue_processing_job(s.id,p_participant_id,'detect',s.original_asset_id,null,false);
 elsif p_action='personal-begin' then
  if c.phase<>'personal' or not p_participant_id=any(c.roster_ids) then raise exception 'Collaboration locked'; end if;
  select * into o from original_selections where session_id=s.id and participant_id=p_participant_id;
  if o.participant_id is null or cardinality(o.selected_region_ids)=0 then raise exception 'Selection required'; end if;
  if exists(select 1 from unnest(o.selected_region_ids) r where not exists(select 1 from region_claims where session_id=s.id and participant_id=p_participant_id and region_id=r)) then raise exception 'Selection required'; end if;
  select * into e from personal_edits where participant_id=p_participant_id;
  if e.done then raise exception 'Collaboration locked'; end if;
  if e.edit_token is not null then return collaboration_view(s.id,p_participant_id); end if;
  if o.mask_asset_id::text is distinct from p_payload->>'sourceMaskAssetId' or to_jsonb(o.selected_region_ids) is distinct from p_payload->'selectedRegionIds' then raise exception 'Version changed'; end if;
  a:=p_payload->'mask';
  if a->>'id' is null then raise exception 'Selection required'; end if;
  insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type)
  select (a->>'id')::uuid,s.id,p_participant_id,'mask',a->>'storageKey',p.width,p.height,'image/png' from photo_assets p where p.id=s.original_asset_id;
  insert into personal_edits(session_id,participant_id,edit_token,mask_asset_id,selected_region_ids)
  values(s.id,p_participant_id,gen_random_uuid(),(a->>'id')::uuid,o.selected_region_ids)
  on conflict(participant_id) do update set edit_token=coalesce(personal_edits.edit_token,excluded.edit_token),mask_asset_id=excluded.mask_asset_id,selected_region_ids=excluded.selected_region_ids;
 elsif p_action in ('personal-cancel','personal-save') then
  select * into e from personal_edits where session_id=s.id and participant_id=p_participant_id;
  if c.phase<>'personal' or e.done or e.edit_token is null or e.edit_token::text is distinct from p_payload->>'token' then raise exception 'Edit token expired'; end if;
  if p_action='personal-cancel' then
   update personal_edits set edit_token=null where participant_id=p_participant_id;
  else
   if not exists(select 1 from photo_assets where id=(p_payload->>'editedAssetId')::uuid and session_id=s.id and participant_id=p_participant_id and kind='edited') then raise exception 'Forbidden'; end if;
   -- Sanitized asset records are supplied exclusively by the trusted server after image masking.
   for a in select value from jsonb_array_elements(p_payload->'assets') loop
    if a->>'kind' not in ('edited','mask') then raise exception 'Forbidden'; end if;
    next_order:=null;
    if a->>'kind'='edited' then select coalesce(max(upload_order),0)+1 into next_order from photo_assets where session_id=s.id; end if;
    insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type,upload_order)
    select (a->>'id')::uuid,s.id,p_participant_id,a->>'kind',a->>'storageKey',p.width,p.height,'image/png',next_order from photo_assets p where p.id=s.original_asset_id;
    if a->>'kind'='edited' then asset_id:=(a->>'id')::uuid; else mask_id:=(a->>'id')::uuid; end if;
   end loop;
   if asset_id is null or mask_id is null then raise exception 'Invalid save'; end if;
   delete from selections where session_id=s.id and participant_id=p_participant_id;
   insert into selections values(p_participant_id,s.id,asset_id,mask_id);
   update personal_edits set done=true,edit_token=null,state=p_payload->'state' where participant_id=p_participant_id;
   update participants set submitted=true where id=p_participant_id;
   update photo_sessions set version=version+1 where id=s.id;
   insert into collaboration_save_receipts values(s.id,p_participant_id,(p_payload->>'token')::uuid,(p_payload->>'editedAssetId')::uuid,p_action);
  end if;
 elsif p_action='compose' then
  if c.phase not in ('personal','composing') or cardinality(c.roster_ids)=0 or exists(select 1 from unnest(c.roster_ids) r where not exists(select 1 from personal_edits where participant_id=r and done)) then raise exception 'All participants required'; end if;
  update session_collaboration set phase='composing' where session_id=s.id;
  j:=enqueue_processing_job(s.id,p_participant_id,'compose',null,s.version,true);
 elsif p_action='open-global' then
  if c.phase<>'composing' or not exists(select 1 from composition_results where session_id=s.id and version=s.version and result_asset_id=(p_payload->>'resultAssetId')::uuid) then raise exception 'Composition required'; end if;
  update session_collaboration set phase='global',latest_asset_id=(p_payload->>'resultAssetId')::uuid where session_id=s.id;
 elsif p_action='acquire' then
  if c.phase<>'global' then raise exception 'Collaboration locked'; end if;
  if c.lease_until>now() and c.editor_id<>p_participant_id then raise exception 'Editor busy'; end if;
  update session_collaboration set editor_id=p_participant_id,edit_token=case when c.lease_until>now() then c.edit_token else gen_random_uuid() end,lease_until=now()+interval '90 seconds' where session_id=s.id;
 elsif p_action in ('heartbeat','cancel','save') then
  if c.phase<>'global' or c.editor_id is distinct from p_participant_id or c.edit_token::text is distinct from p_payload->>'token' or c.lease_until is null or c.lease_until<=now() then raise exception 'Edit token expired'; end if;
  if p_action='heartbeat' then update session_collaboration set lease_until=now()+interval '90 seconds' where session_id=s.id;
  elsif p_action='cancel' then update session_collaboration set editor_id=null,edit_token=null,lease_until=null where session_id=s.id;
  else
   if c.version is distinct from (p_payload->>'baseVersion')::integer then raise exception 'Version changed'; end if;
   if not exists(select 1 from photo_assets where id=(p_payload->>'editedAssetId')::uuid and session_id=s.id and participant_id=p_participant_id and kind='edited') then raise exception 'Forbidden'; end if;
   a:=p_payload->'asset'; asset_id:=(a->>'id')::uuid;
   if asset_id is null then raise exception 'Invalid save'; end if;
   insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type)
   select asset_id,s.id,null,'result',a->>'storageKey',p.width,p.height,'image/png' from photo_assets p where p.id=s.original_asset_id;
   insert into global_edit_history(session_id,version,participant_id,asset_id,state) values(s.id,c.version+1,p_participant_id,asset_id,p_payload->'state');
   update session_collaboration set version=version+1,latest_asset_id=asset_id,editor_id=null,edit_token=null,lease_until=null where session_id=s.id;
   insert into collaboration_save_receipts values(s.id,p_participant_id,(p_payload->>'token')::uuid,(p_payload->>'editedAssetId')::uuid,p_action);
  end if;
 elsif p_action='end-global' then
  if c.phase<>'global' or c.lease_until>now() then raise exception 'Editor busy'; end if;
  update session_collaboration set phase='review',editor_id=null,edit_token=null,lease_until=null where session_id=s.id;
 elsif p_action='finalize' then
  if c.phase<>'review' or c.latest_asset_id is null or c.lease_until>now() then raise exception 'Collaboration locked'; end if;
  update session_collaboration set phase='final' where session_id=s.id;
 elsif p_action not in ('enable','read') then raise exception 'Invalid action';
 end if;
 return collaboration_view(s.id,p_participant_id) || case when j is null then '{}'::jsonb else jsonb_build_object('job',jsonb_build_object('id',j->>'id','status',j->>'status')) end;
end; $$;

alter function public.join_photo_session(uuid,uuid,text,text,text) rename to join_photo_session_before_collaboration;
create function public.join_photo_session(p_session_id uuid,p_participant_id uuid,p_nickname text,p_session_token_hash text,p_recovery_token_hash text) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform collaboration_guard(p_session_id,p_participant_id,'join');
 perform join_photo_session_before_collaboration(p_session_id,p_participant_id,p_nickname,p_session_token_hash,p_recovery_token_hash);
end; $$;
revoke all on function public.join_photo_session(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.join_photo_session(uuid,uuid,text,text,text) to service_role;

alter function public.set_region_claim(uuid,uuid,text,boolean) rename to set_region_claim_before_collaboration;
create function public.set_region_claim(p_session_id uuid,p_participant_id uuid,p_region_id text,p_selected boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 perform collaboration_guard(p_session_id,p_participant_id,'selection');
 return set_region_claim_before_collaboration(p_session_id,p_participant_id,p_region_id,p_selected);
end; $$;
revoke all on function public.set_region_claim(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.set_region_claim(uuid,uuid,text,boolean) to service_role;

alter function public.replace_original_selection(uuid,uuid,uuid,text[],integer) rename to replace_original_selection_before_collaboration;
create function public.replace_original_selection(p_session_id uuid,p_participant_id uuid,p_mask_asset_id uuid,p_selected_region_ids text[],p_expected_version integer) returns integer language plpgsql security invoker set search_path=public as $$
begin
 perform collaboration_guard(p_session_id,p_participant_id,'selection');
 return replace_original_selection_before_collaboration(p_session_id,p_participant_id,p_mask_asset_id,p_selected_region_ids,p_expected_version);
end; $$;
revoke all on function public.replace_original_selection(uuid,uuid,uuid,text[],integer) from public,anon,authenticated;
grant execute on function public.replace_original_selection(uuid,uuid,uuid,text[],integer) to service_role;

alter function public.replace_selection(uuid,uuid,uuid,uuid,integer,boolean) rename to replace_selection_before_collaboration;
create function public.replace_selection(p_session_id uuid,p_participant_id uuid,p_edited_asset_id uuid,p_mask_asset_id uuid,p_expected_version integer,p_submitted boolean) returns integer language plpgsql security invoker set search_path=public as $$
begin
 perform collaboration_guard(p_session_id,p_participant_id,'legacy-save');
 return replace_selection_before_collaboration(p_session_id,p_participant_id,p_edited_asset_id,p_mask_asset_id,p_expected_version,p_submitted);
end; $$;
revoke all on function public.replace_selection(uuid,uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.replace_selection(uuid,uuid,uuid,uuid,integer,boolean) to service_role;

alter function public.replace_overlap_assignments(uuid,uuid,jsonb,integer) rename to replace_overlap_assignments_before_collaboration;
create function public.replace_overlap_assignments(p_session_id uuid,p_participant_id uuid,p_assignments jsonb,p_expected_version integer) returns integer language plpgsql security invoker set search_path=public as $$
begin
 perform collaboration_guard(p_session_id,p_participant_id,'legacy-save');
 return replace_overlap_assignments_before_collaboration(p_session_id,p_participant_id,p_assignments,p_expected_version);
end; $$;
revoke all on function public.replace_overlap_assignments(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.replace_overlap_assignments(uuid,uuid,jsonb,integer) to service_role;

alter function public.enqueue_processing_job(uuid,uuid,text,uuid,integer,boolean) rename to enqueue_processing_job_before_collaboration;
create function public.enqueue_processing_job(p_session_id uuid,p_participant_id uuid,p_kind text,p_asset_id uuid default null,p_version integer default null,p_retry boolean default false) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 perform collaboration_guard(p_session_id,p_participant_id,case when p_kind='compose' then 'compose' else 'detect' end);
 return enqueue_processing_job_before_collaboration(p_session_id,p_participant_id,p_kind,p_asset_id,p_version,p_retry);
end; $$;
revoke all on function public.enqueue_processing_job(uuid,uuid,text,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_processing_job(uuid,uuid,text,uuid,integer,boolean) to service_role;

alter function public.publish_composition(jsonb,jsonb,uuid) rename to publish_composition_before_collaboration;
create function public.publish_composition(p_result jsonb,p_assets jsonb,p_participant_id uuid) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 perform collaboration_guard((p_result->>'sessionId')::uuid,p_participant_id,'compose');
 return publish_composition_before_collaboration(p_result,p_assets,p_participant_id);
end; $$;
revoke all on function public.publish_composition(jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.publish_composition(jsonb,jsonb,uuid) to service_role;

alter function public.register_photo_asset(jsonb) rename to register_photo_asset_before_collaboration;
create function public.register_photo_asset(p_asset jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare s photo_sessions; original photo_assets; a photo_assets; next_order integer;
begin
 perform collaboration_guard((p_asset->>'sessionId')::uuid,(p_asset->>'participantId')::uuid,'upload');
 if not exists(select 1 from session_collaboration where session_id=(p_asset->>'sessionId')::uuid) then return register_photo_asset_before_collaboration(p_asset); end if;
 select * into s from photo_sessions where id=(p_asset->>'sessionId')::uuid for update;
 if s.id is null or s.expires_at<=now() then raise exception 'Session expired'; end if;
 if not exists(select 1 from participants where session_id=s.id and id=(p_asset->>'participantId')::uuid) or p_asset->>'kind' not in ('edited','mask') then raise exception 'Forbidden'; end if;
 select * into original from photo_assets where id=s.original_asset_id;
 if original.width<>(p_asset->>'width')::integer or original.height<>(p_asset->>'height')::integer then raise exception 'Invalid asset dimensions'; end if;
 if p_asset->>'kind'='edited' then select coalesce(max(upload_order),0)+1 into next_order from photo_assets where session_id=s.id; end if;
 insert into photo_assets(id,session_id,participant_id,kind,storage_key,width,height,content_type,upload_order)
 values((p_asset->>'id')::uuid,s.id,(p_asset->>'participantId')::uuid,p_asset->>'kind',p_asset->>'storageKey',(p_asset->>'width')::integer,(p_asset->>'height')::integer,p_asset->>'contentType',next_order) returning * into a;
 return to_jsonb(a);
end; $$;
revoke all on function public.register_photo_asset(jsonb),public.collaboration_guard(uuid,uuid,text),public.collaboration_action(uuid,uuid,text,jsonb),public.collaboration_view(uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_photo_asset(jsonb),public.collaboration_guard(uuid,uuid,text),public.collaboration_action(uuid,uuid,text,jsonb),public.collaboration_view(uuid,uuid) to service_role;

-- A late worker cannot mutate a collaborative room after its processing phase.
alter function public.complete_processing_job(uuid,uuid,jsonb) rename to complete_processing_job_before_collaboration;
create function public.complete_processing_job(p_id uuid,p_lease_token uuid,p_result jsonb) returns boolean language plpgsql security invoker set search_path=public as $$
declare j processing_jobs; c session_collaboration;
begin
 perform 1 from photo_sessions s join processing_jobs q on q.session_id=s.id where q.id=p_id for update of s;
 select * into j from processing_jobs where id=p_id;
 select * into c from session_collaboration where session_id=j.session_id;
 if c.session_id is not null and j.status<>'ready' and ((j.kind='detect' and c.phase<>'personal') or (j.kind='compose' and c.phase<>'composing')) then return false; end if;
 return complete_processing_job_before_collaboration(p_id,p_lease_token,p_result);
end; $$;
revoke all on function public.complete_processing_job(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_processing_job(uuid,uuid,jsonb) to service_role;
