-- Only the authenticated worker API (service role) can record or read liveness.
create table public.worker_presence (
  worker_name text primary key check (worker_name in ('mac', 'windows')),
  instance_id uuid not null,
  last_seen_at timestamptz not null default now()
);
alter table public.worker_presence enable row level security;
revoke all on public.worker_presence from public, anon, authenticated;
grant select, insert, update on public.worker_presence to service_role;

create function public.mark_worker_present(p_worker_name text, p_instance_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
  insert into worker_presence(worker_name, instance_id, last_seen_at)
  values (p_worker_name, p_instance_id, now())
  on conflict (worker_name) do update
    set instance_id=excluded.instance_id, last_seen_at=excluded.last_seen_at;
end; $$;
revoke all on function public.mark_worker_present(text, uuid) from public, anon, authenticated;
grant execute on function public.mark_worker_present(text, uuid) to service_role;
