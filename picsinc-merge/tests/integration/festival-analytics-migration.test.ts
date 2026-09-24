import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../supabase/migrations/20260924050000_festival_analytics.sql", import.meta.url);
const sql = await readFile(migrationUrl, "utf8");

function body(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(`create or replace function public\\.${escaped}\\b[\\s\\S]*?\\$\\$;`, "i"));
  assert.ok(match, `${name} must be replaced by the analytics migration`);
  return match[0];
}

test("analytics rows survive the 24-hour room cascade and contain no private payload fields", () => {
  const table = sql.match(/create table public\.festival_analytics_events \([\s\S]*?\n\);/i)?.[0];
  assert.ok(table);
  assert.doesNotMatch(table, /references\s+public\.(photo_sessions|participants|photo_assets)/i);
  assert.doesNotMatch(table, /invite_token|nickname|storage_key|session_token|recovery_token|image|photo/i);
  assert.match(sql, /event_context text not null check \(event_context in \('test', 'festival'\)\)/i);
  assert.match(sql, /create table public\.festival_analytics_room_contexts[\s\S]*session_id uuid primary key/i);
  assert.doesNotMatch(sql.match(/create table public\.festival_analytics_room_contexts \([\s\S]*?\n\);/i)?.[0] ?? "", /references/i);
});

test("room success records the room and its owner as a participant after durable inserts", () => {
  const fn = body("create_photo_session");
  const asset = fn.indexOf("insert into photo_assets");
  const room = fn.indexOf("record_festival_analytics_event('room_created'");
  const owner = fn.indexOf("record_festival_analytics_event('participant_joined'");
  assert.ok(asset >= 0 && room > asset && owner > room);
});

test("join, edited upload, submission, and composition events follow their successful state writes", () => {
  const join = body("join_photo_session");
  assert.ok(join.indexOf("record_festival_analytics_event('participant_joined'") > join.indexOf("insert into participant_credentials"));

  const asset = body("register_photo_asset");
  assert.ok(asset.indexOf("record_festival_analytics_event('edited_upload_completed'") > asset.indexOf("insert into photo_assets"));
  assert.match(asset, /if a\.kind='edited'[\s\S]*record_festival_analytics_event\('edited_upload_completed'/i);

  const selection = body("replace_selection");
  assert.ok(selection.indexOf("record_festival_analytics_event('area_submitted'") > selection.indexOf("update participants set submitted=p_submitted"));
  assert.match(selection, /if p_submitted then[\s\S]*record_festival_analytics_event\('area_submitted'/i);

  const composition = body("complete_processing_job");
  assert.ok(composition.indexOf("record_festival_analytics_event('composition_succeeded'") > composition.indexOf("set status='ready'"));
  assert.match(composition, /if j\.kind='compose' then[\s\S]*record_festival_analytics_event\('composition_succeeded'/i);
});

test("natural unique keys deduplicate retries while first-completion view collapses repeat milestones", () => {
  for (const index of [
    /unique index festival_analytics_room_created_once[\s\S]*event_name, session_id/i,
    /unique index festival_analytics_participant_joined_once[\s\S]*event_name, participant_id/i,
    /unique index festival_analytics_edited_upload_once[\s\S]*event_name, asset_id/i,
    /unique index festival_analytics_area_submission_once_per_version[\s\S]*event_name, session_id, participant_id, session_version/i,
    /unique index festival_analytics_composition_once[\s\S]*event_name, processing_job_id/i,
  ]) assert.match(sql, index);
  assert.match(sql, /insert into festival_analytics_events[\s\S]*on conflict do nothing/i);
  assert.match(sql, /where event_name in \('area_submitted', 'composition_succeeded'\)/i);
  assert.match(sql, /case when event_name = 'area_submitted' then participant_id end/i);
  assert.match(sql, /where completion_number = 1/i);
});

test("the global setting selects new rooms only and later events inherit their room context", () => {
  const recorder = sql.match(/create function public\.record_festival_analytics_event\b[\s\S]*?\$\$;/i)?.[0];
  assert.ok(recorder);
  assert.match(recorder, /if p_event_name = 'room_created' then[\s\S]*insert into festival_analytics_room_contexts[\s\S]*from festival_analytics_settings/i);
  assert.match(recorder, /from festival_analytics_room_contexts where session_id = p_session_id/i);
  assert.match(sql, /insert into public\.festival_analytics_room_contexts[\s\S]*select id, 'test' from public\.photo_sessions/i);
});
