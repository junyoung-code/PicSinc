import { CompositionError } from "@/features/composition/compose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { RegionClaimConflict, SessionError } from "@/features/photo-session/errors";
import { PhotoSessionService } from "@/features/photo-session/service";
import { SupabasePhotoSessionStore, SupabasePrivateFileStore } from "@/integrations/storage/supabase-photo-session-store";

const prefix = "picsinc_session_";
export const service = () => new PhotoSessionService(new SupabasePhotoSessionStore(), new SupabasePrivateFileStore());
export const cookieName = (inviteToken: string) => `${prefix}${inviteToken}`;

export async function credentials(inviteToken: string) {
  const value = (await cookies()).get(cookieName(inviteToken))?.value;
  if (!value) throw new SessionError(403, "이 브라우저의 참여증이 없습니다.");
  const [participantId, sessionToken] = value.split(".");
  if (!participantId || !sessionToken) throw new SessionError(403, "참여증이 올바르지 않습니다.");
  return { participantId, sessionToken };
}

export function setCredentials(response: NextResponse, inviteToken: string, participantId: string, sessionToken: string) {
  response.cookies.set(cookieName(inviteToken), `${participantId}.${sessionToken}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 24 * 60 * 60 });
}

export function apiError(error: unknown) {
  if (error instanceof RegionClaimConflict) return NextResponse.json({ error: error.message, claim: error.claim }, { status: 409 });
  if (error instanceof CompositionError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  if (error instanceof SessionError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  console.error("photo session request failed", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "요청을 처리하지 못했습니다." }, { status: 500 });
}

export function recoveryUrl(request: Request, inviteToken: string, recoveryToken: string) {
  return `/sessions/${inviteToken}/recover#token=${recoveryToken}`;
}
