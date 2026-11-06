import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const project = new URL("../../../", import.meta.url);
const sqlFile = (path: string) => readFile(new URL(path, project), "utf8");

export async function currentSchemaDatabase(beforeAnalytics?: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null);
    create table storage.objects (id uuid primary key default gen_random_uuid());
  `);

  // These files describe the initial project state that predates the numbered
  // migrations. Cleanup SQL is intentionally excluded because it provisions
  // Supabase Vault, pg_cron, pg_net, and a deployed Edge Function URL.
  for (const path of [
    "src/integrations/storage/schema.sql",
    "src/integrations/storage/integration.sql",
    "src/integrations/storage/multiple-selections.sql",
    "src/integrations/storage/mobile-flow.sql",
  ]) {
    let sql = await sqlFile(path);
    // PGlite has PostgreSQL's built-in gen_random_uuid(), but does not package
    // Supabase's pgcrypto extension. Only the unavailable declaration is omitted.
    if (path.endsWith("schema.sql")) sql = sql.replace("create extension if not exists pgcrypto;", "");
    await db.exec(sql);
  }

  const migrationDirectory = new URL("supabase/migrations/", project);
  for (const name of (await readdir(migrationDirectory)).filter(name => name.endsWith(".sql")).sort()) {
    if (name.endsWith("_festival_analytics.sql") && beforeAnalytics) await beforeAnalytics(db);
    await db.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
  }
  const installed=await db.query<{present:boolean}>("select to_regclass('public.session_collaboration') is not null as present");
  if (!installed.rows[0].present) await db.exec(await sqlFile("src/integrations/storage/collaboration.sql"));
  await db.exec(await sqlFile("src/integrations/storage/retouch-rooms.sql"));
  return db;
}
