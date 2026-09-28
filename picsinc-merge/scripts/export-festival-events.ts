import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const day = process.argv[2];
if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00+09:00`))) {
  throw new Error("Usage: node --env-file=.env.local --import tsx scripts/export-festival-events.ts YYYY-MM-DD");
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Supabase server credentials are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const start = new Date(`${day}T00:00:00+09:00`);
const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
const columns = "id,event_name,event_context,occurred_at,session_id,participant_id,asset_id,processing_job_id,session_version,visit_id,device_kind,client_event_id,stage,error_code,attempt,queue_ms,download_ms,processing_ms,upload_ms";
const filter = () => db.from("festival_analytics_events").select(columns)
  .gte("occurred_at", start.toISOString()).lt("occurred_at", end.toISOString());
const latest = await filter().order("id", { ascending: false }).limit(1);
if (latest.error) throw new Error("Could not read event boundary");
const maxId = latest.data?.[0]?.id ?? 0;
const countResult = await db.from("festival_analytics_events").select("id", { count: "exact", head: true })
  .gte("occurred_at", start.toISOString()).lt("occurred_at", end.toISOString()).lte("id", maxId);
if (countResult.error) throw new Error("Could not count events");
const expected = countResult.count ?? 0;
const destination = path.resolve("private", "festival-export", `${day}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(destination, { recursive: true, mode: 0o700 });
const eventFile = path.join(destination, "events.jsonl");
await writeFile(eventFile, "", { mode: 0o600 });
let cursor = 0;
let exported = 0;
const summary = new Map<string, number>();
while (true) {
  const page = await filter().gt("id", cursor).lte("id", maxId).order("id").limit(500);
  if (page.error) throw new Error("Could not export events");
  if (!page.data?.length) break;
  await appendFile(eventFile, page.data.map(row => JSON.stringify(row)).join("\n") + "\n");
  for (const row of page.data) {
    const key = [row.event_context, row.event_name, row.stage ?? "", row.error_code ?? ""].join("\u0000");
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  cursor = page.data.at(-1)!.id;
  exported += page.data.length;
}
if (exported !== expected) throw new Error(`Export count mismatch: ${exported} of ${expected}`);
const csv = ["event_context,event_name,stage,error_code,count", ...[...summary.entries()].sort().map(([key, count]) =>
  `${key.split("\u0000").map(value => `"${value.replaceAll('"', '""')}"`).join(",")},${count}`)].join("\n") + "\n";
await writeFile(path.join(destination, "summary.csv"), csv, { mode: 0o600 });
await writeFile(path.join(destination, "manifest.json"), JSON.stringify({ festivalDateKst: day, exportedAt: new Date().toISOString(), startInclusive: start.toISOString(), endExclusive: end.toISOString(), maxEventId: maxId, dbCount: expected, exportedCount: exported }, null, 2) + "\n", { mode: 0o600 });
console.log(`Exported ${exported} events to ${destination}`);
