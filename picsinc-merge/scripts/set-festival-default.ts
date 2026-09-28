import { createClient } from "@supabase/supabase-js";

const next = process.argv[2];
if (next !== "test" && next !== "festival") throw new Error("Usage: node --env-file=.env.local --import tsx scripts/set-festival-default.ts test|festival");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Supabase server credentials are required");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.from("festival_analytics_settings").update({ event_context: next }).eq("singleton", true).select("event_context").single();
if (error || data?.event_context !== next) throw new Error("Could not change the default event context");
console.log(`New rooms and visits default to ${next}; existing rooms retain their original context.`);
