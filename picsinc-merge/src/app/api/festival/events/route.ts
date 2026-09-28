import { NextResponse } from "next/server";
import { credentials, service } from "@/app/api/sessions/session-api";
import { defaultEventContext, recordFestivalEvent, roomEventContext, validUuid, type EventContext, type FestivalEvent } from "@/core/festival-analytics-server";
import { SupabasePhotoSessionStore } from "@/integrations/storage/supabase-photo-session-store";
import { supabaseServer } from "@/integrations/storage/supabase-server";

const deviceKinds = new Set(["mobile", "tablet", "desktop", "unknown"]);
const failureStages = new Set(["original_upload", "edited_upload", "region_claim", "area_submit", "composition", "result_view"]);
const clientEvents = new Set(["visit_started", "room_opened", "result_displayed", "save_clicked", "stage_failed"]);
const response = (status: number) => NextResponse.json({ error: "Invalid event" }, { status });

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || Number(request.headers.get("content-length") || 0) > 2048) return response(400);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return response(403);
    const raw = await request.text();
    if (raw.length > 2048) return response(413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || !clientEvents.has(body.eventName) || !validUuid(body.visitId) || !deviceKinds.has(body.deviceKind)) return response(400);
    const event: FestivalEvent = { event_name: body.eventName, visit_id: body.visitId, device_kind: body.deviceKind };
    let context: EventContext | undefined;
    if (body.eventName === "visit_started") {
      if (typeof body.inviteToken === "string" && body.inviteToken.length <= 128) {
        const session = await new SupabasePhotoSessionStore().findSessionByInvite(body.inviteToken);
        if (session && Date.parse(session.expiresAt) > Date.now()) context = await roomEventContext(session.id);
      }
      context ??= await defaultEventContext();
    } else if (body.eventName === "stage_failed" && body.stage === "original_upload" && !body.inviteToken) {
      if (!failureStages.has(body.stage) || typeof body.errorCode !== "string" || !/^[a-z0-9_]{1,48}$/.test(body.errorCode) || !validUuid(body.clientEventId)) return response(400);
      event.stage = body.stage; event.error_code = body.errorCode; event.client_event_id = body.clientEventId;
      if (validUuid(body.uploadId)) {
        const { data } = await supabaseServer().from("photo_upload_intents").select("session_id,analytics_context").eq("id", body.uploadId).eq("kind", "original").maybeSingle();
        if (data) { event.session_id = data.session_id; context = data.analytics_context as EventContext | undefined; }
      }
      context ??= await defaultEventContext();
    } else {
      if (typeof body.inviteToken !== "string" || body.inviteToken.length > 128) return response(400);
      if (body.eventName === "room_opened") {
        const session = await new SupabasePhotoSessionStore().findSessionByInvite(body.inviteToken);
        if (!session || Date.parse(session.expiresAt) <= Date.now()) return response(404);
        event.session_id = session.id;
      } else {
        const credential = await credentials(body.inviteToken);
        const snapshot = await service().snapshot(body.inviteToken, credential.participantId, credential.sessionToken);
        event.session_id = snapshot.session.id;
        event.participant_id = credential.participantId;
        if (body.eventName === "result_displayed" || body.eventName === "save_clicked") {
          if (!snapshot.result || !validUuid(body.assetId) || body.assetId !== snapshot.result.resultAssetId || !validUuid(body.clientEventId)) return response(400);
          event.asset_id = body.assetId;
          event.client_event_id = body.clientEventId;
          event.session_version = snapshot.result.version;
        } else if (body.eventName === "stage_failed") {
          if (!failureStages.has(body.stage) || body.stage === "original_upload" || typeof body.errorCode !== "string" || !/^[a-z0-9_]{1,48}$/.test(body.errorCode) || !validUuid(body.clientEventId)) return response(400);
          event.stage = body.stage; event.error_code = body.errorCode; event.client_event_id = body.clientEventId;
        } else return response(400);
      }
      context = await roomEventContext(event.session_id as string);
    }
    await recordFestivalEvent(event, context);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return response(503);
  }
}
