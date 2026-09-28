import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseServer } from "@/integrations/storage/supabase-server";

export type EventContext = "test" | "festival";
export const testModeCookie = "picsinc_festival_test";
const fourHours = 4 * 60 * 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

function operatorCode() {
  const code = process.env.FESTIVAL_OPERATOR_CODE;
  if (!code || code.length < 32) throw new Error("FESTIVAL_OPERATOR_CODE must contain at least 32 characters");
  return code;
}
export function verifyOperatorCode(input: string): boolean {
  const expected = createHmac("sha256", operatorCode()).update("operator").digest();
  const received = createHmac("sha256", input).update("operator").digest();
  return timingSafeEqual(expected, received);
}
export function signedTestMode(): string {
  const expiry = Math.floor(Date.now() / 1000) + fourHours;
  const signature = createHmac("sha256", operatorCode()).update(String(expiry)).digest("base64url");
  return `${expiry}.${signature}`;
}
export async function testModeActive(): Promise<boolean> {
  const value = (await cookies()).get(testModeCookie)?.value;
  if (!value || !/^\d{10,11}\.[\w-]{43}$/.test(value)) return false;
  const [expiry, signature] = value.split(".");
  if (Number(expiry) < Date.now() / 1000) return false;
  const expected = createHmac("sha256", operatorCode()).update(expiry).digest("base64url");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export async function defaultEventContext(): Promise<EventContext> {
  if (await testModeActive()) return "test";
  const { data, error } = await supabaseServer().from("festival_analytics_settings").select("event_context").eq("singleton", true).single();
  if (error || !data) throw new Error("Festival analytics setting unavailable");
  return data.event_context as EventContext;
}
export async function roomEventContext(sessionId: string): Promise<EventContext> {
  const { data, error } = await supabaseServer().from("festival_analytics_room_contexts").select("event_context").eq("session_id", sessionId).single();
  if (error || !data) throw new Error("Festival room context unavailable");
  return data.event_context as EventContext;
}
export type FestivalEvent = {
  event_name: string; session_id?: string | null; visit_id?: string | null;
  device_kind?: string | null; client_event_id?: string | null;
  participant_id?: string | null; asset_id?: string | null; processing_job_id?: string | null;
  session_version?: number | null; stage?: string | null; error_code?: string | null;
  attempt?: number | null; queue_ms?: number | null; download_ms?: number | null;
  processing_ms?: number | null; upload_ms?: number | null;
};
export async function recordFestivalEvent(event: FestivalEvent, context?: EventContext) {
  const eventContext = context ?? (event.session_id ? await roomEventContext(event.session_id) : await defaultEventContext());
  const { error } = await supabaseServer().from("festival_analytics_events").insert({ ...event, event_context: eventContext });
  if (error && error.code !== "23505") throw new Error("Festival event could not be recorded");
}

export function boundedMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000 ? Math.round(value) : null;
}
