-- Deployment also provisions the active project legacy anon JWT in Vault as picsinc_cleanup_anon.
-- A separate random maintenance credential. Plaintext stays in Vault, never in source/logs.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table public.cleanup_credentials (id boolean primary key default true check(id), token_hash text not null);
alter table public.cleanup_credentials enable row level security;
revoke all on public.cleanup_credentials from public, anon, authenticated;
grant select on public.cleanup_credentials to service_role;
do $$ declare token text := encode(extensions.gen_random_bytes(32),'hex'); begin
 perform vault.create_secret(token, 'picsinc_cleanup_token');
 insert into public.cleanup_credentials values (true, encode(extensions.digest(token,'sha256'),'hex'));
end $$;
select cron.schedule('picsinc-expired-cleanup', '*/5 * * * *', $job$
 select net.http_post(
 url := 'https://zogtpmolcmpiipwbysck.supabase.co/functions/v1/cleanup-expired',
 headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='picsinc_cleanup_anon'),'x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='picsinc_cleanup_token')),
 body := '{}'::jsonb, timeout_milliseconds := 120000
 );
$job$);
