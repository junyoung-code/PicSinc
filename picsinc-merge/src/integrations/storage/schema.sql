-- Initial schema reviewed by main; applied as initial_photo_sessions
-- to the dedicated picsinc-merge project on 2026-09-09. Do not rerun on existing tables.
create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public) values ('picsinc-merge', 'picsinc-merge', false)
on conflict (id) do update set public = false;

create table public.photo_sessions (
  id uuid primary key, invite_token text not null unique, original_asset_id uuid not null,
  version integer not null default 1, created_at timestamptz not null, expires_at timestamptz not null
);
create table public.participants (id uuid primary key, session_id uuid not null references public.photo_sessions(id) on delete cascade, nickname text not null check (char_length(nickname) between 1 and 40));
create table public.participant_credentials (participant_id uuid primary key references public.participants(id) on delete cascade, session_id uuid not null references public.photo_sessions(id) on delete cascade, session_token_hash text not null, recovery_token_hash text not null unique);
create table public.photo_assets (id uuid primary key, session_id uuid not null references public.photo_sessions(id) on delete cascade, participant_id uuid references public.participants(id) on delete cascade, kind text not null check (kind in ('original','edited','mask','preview','result')), storage_key text not null unique, width integer not null check (width > 0), height integer not null check (height > 0), content_type text not null check (content_type in ('image/png','image/jpeg')));
alter table public.photo_sessions add constraint photo_sessions_original_asset foreign key (original_asset_id) references public.photo_assets(id) deferrable initially deferred;
create table public.selections (participant_id uuid references public.participants(id) on delete cascade, session_id uuid not null references public.photo_sessions(id) on delete cascade, edited_asset_id uuid not null references public.photo_assets(id), mask_asset_id uuid not null references public.photo_assets(id), primary key (participant_id, edited_asset_id));
create table public.overlap_assignments (session_id uuid not null references public.photo_sessions(id) on delete cascade, edited_asset_id uuid not null references public.photo_assets(id), mask_asset_id uuid not null references public.photo_assets(id), primary key (session_id, edited_asset_id, mask_asset_id));

alter table public.photo_sessions enable row level security;
alter table public.participants enable row level security;
alter table public.participant_credentials enable row level security;
alter table public.photo_assets enable row level security;
alter table public.selections enable row level security;
alter table public.overlap_assignments enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on storage.objects from anon, authenticated;

create or replace function public.create_photo_session(p_session_id uuid, p_invite_token text, p_original_asset_id uuid, p_created_at timestamptz, p_expires_at timestamptz, p_participant_id uuid, p_nickname text, p_session_token_hash text, p_recovery_token_hash text, p_storage_key text, p_width integer, p_height integer, p_content_type text) returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into photo_sessions (id, invite_token, original_asset_id, created_at, expires_at) values (p_session_id, p_invite_token, p_original_asset_id, p_created_at, p_expires_at);
  insert into participants (id, session_id, nickname) values (p_participant_id, p_session_id, p_nickname);
  insert into participant_credentials values (p_participant_id, p_session_id, p_session_token_hash, p_recovery_token_hash);
  insert into photo_assets (id, session_id, participant_id, kind, storage_key, width, height, content_type) values (p_original_asset_id, p_session_id, null, 'original', p_storage_key, p_width, p_height, p_content_type);
end; $$;

create or replace function public.replace_selection(p_session_id uuid, p_participant_id uuid, p_edited_asset_id uuid, p_mask_asset_id uuid, p_expected_version integer) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version = version + 1 where id = p_session_id and version = p_expected_version and expires_at > now() returning version into next_version;
  if next_version is null then return null; end if;
  insert into selections (participant_id, session_id, edited_asset_id, mask_asset_id) values (p_participant_id, p_session_id, p_edited_asset_id, p_mask_asset_id) on conflict (participant_id, edited_asset_id) do update set mask_asset_id = excluded.mask_asset_id;
  return next_version;
end; $$;

create or replace function public.replace_overlap_assignments(p_session_id uuid, p_assignments jsonb, p_expected_version integer) returns integer language plpgsql security invoker set search_path = public as $$
declare next_version integer;
begin
  update photo_sessions set version = version + 1 where id = p_session_id and version = p_expected_version returning version into next_version;
  if next_version is null then return null; end if;
  delete from overlap_assignments where session_id = p_session_id;
  insert into overlap_assignments (session_id, edited_asset_id, mask_asset_id) select p_session_id, (item->>'edited_asset_id')::uuid, (item->>'mask_asset_id')::uuid from jsonb_array_elements(p_assignments) item;
  return next_version;
end; $$;

revoke all on function public.create_photo_session(uuid, text, uuid, timestamptz, timestamptz, uuid, text, text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.replace_selection(uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.replace_overlap_assignments(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.create_photo_session(uuid, text, uuid, timestamptz, timestamptz, uuid, text, text, text, text, integer, integer, text) to service_role;
grant execute on function public.replace_selection(uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.replace_overlap_assignments(uuid, jsonb, integer) to service_role;
