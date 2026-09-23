import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiError, credentials, recoveryUrl, service, setCredentials } from "@/app/api/sessions/session-api";
import { SupabasePhotoSessionStore } from "@/integrations/storage/supabase-photo-session-store";
import { SupabaseDirectUploadFiles, SupabaseDirectUploadRepository } from "@/integrations/storage/direct-uploads";
import { DirectUploadService, type UploadAuth, type UploadMetadata } from "./direct-uploads-service";
import { createSecretToken } from "./tokens";
import { fail } from "./errors";
import { runHeavyTask } from "@/core/heavy-task";

const bootstrapCookie = "picsinc_upload_owner";
function uploads() {
  const secret = process.env.UPLOAD_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new Error("UPLOAD_SIGNING_SECRET is required");
  return new DirectUploadService(new SupabaseDirectUploadRepository(), new SupabaseDirectUploadFiles(), service(), new SupabasePhotoSessionStore(), secret);
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) fail(400, "JSON 요청이 필요합니다.");
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "요청 형식이 올바르지 않습니다.");
  return value;
}
function metadata(value: Record<string, unknown>): UploadMetadata { return { contentType: typeof value.contentType === "string" ? value.contentType : "", size: typeof value.size === "number" ? value.size : NaN }; }

export async function prepareOriginal(request: Request) {
  try {
    const value = await body(request);
    const bootstrap = (await cookies()).get(bootstrapCookie)?.value || createSecretToken();
    const prepared = await uploads().prepareOriginalUpload(typeof value.nickname === "string" ? value.nickname : "", metadata(value), bootstrap);
    const response = NextResponse.json(prepared, { status: 201, headers: { "Cache-Control": "no-store" } });
    response.cookies.set(bootstrapCookie, bootstrap, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 2 * 60 * 60 });
    return response;
  } catch (error) { return apiError(error); }
}

export async function prepareSession(request: Request, inviteToken: string, kind: string) {
  try {
    if (kind !== "edited" && kind !== "mask") fail(400, "지원하지 않는 파일 종류입니다.");
    const credential = await credentials(inviteToken);
    const prepared = await uploads().prepareSessionUpload({ inviteToken, ...credential }, kind, metadata(await body(request)));
    return NextResponse.json(prepared, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function complete(request: Request, uploadId: string) {
  try {
    const value = await body(request);
    let auth: UploadAuth | undefined;
    if (typeof value.inviteToken === "string") auth = { inviteToken: value.inviteToken, ...await credentials(value.inviteToken) };
    const bootstrap = (await cookies()).get(bootstrapCookie)?.value;
    // Bound concurrent image decodes in a Vercel instance; callers retry a busy 429.
    const result = await runHeavyTask(() => uploads().completeUpload(uploadId, bootstrap, auth));
    if (result.kind === "asset") return NextResponse.json({ asset: result.asset }, { status: 201, headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json({ session: result.session, participant: result.participant, shareUrl: `/sessions/${result.session.inviteToken}`, recoveryUrl: recoveryUrl(request, result.session.inviteToken, result.recoveryToken) }, { status: 201, headers: { "Cache-Control": "no-store" } });
    setCredentials(response, result.session.inviteToken, result.participant.id, result.sessionToken);
    return response;
  } catch (error) { return apiError(error); }
}
