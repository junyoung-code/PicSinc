-- Preserve existing rows; apply with the matching app update.
alter table public.selections drop constraint selections_pkey;
alter table public.selections add primary key (participant_id, edited_asset_id);

create or replace function public.replace_selection(p_session_id uuid, p_participant_id uuid, p_edited_asset_id uuid, p_mask_asset_id uuid, p_expected_version integer) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version = version + 1 where id = p_session_id and version = p_expected_version and expires_at > now() returning version into next_version;
  if next_version is null then return null; end if;
  insert into selections (participant_id, session_id, edited_asset_id, mask_asset_id) values (p_participant_id, p_session_id, p_edited_asset_id, p_mask_asset_id) on conflict (participant_id, edited_asset_id) do update set mask_asset_id = excluded.mask_asset_id;
  return next_version;
end; $$;
