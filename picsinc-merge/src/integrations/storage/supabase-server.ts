import "server-only";
import { createClient } from "@supabase/supabase-js";

export function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL 및 SUPABASE_SECRET_KEY가 필요합니다.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
