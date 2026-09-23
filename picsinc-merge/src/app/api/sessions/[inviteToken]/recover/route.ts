import { NextResponse } from "next/server";
import { apiError, service, setCredentials } from "../../session-api";
export async function POST(request: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  try { const { inviteToken } = await params; const { token } = await request.json(); if (typeof token !== "string") return NextResponse.json({ error: "복구 토큰이 필요합니다." }, { status: 400 }); const recovered = await service().recover(inviteToken, token); const response = NextResponse.json({ participantId: recovered.participantId }); setCredentials(response, inviteToken, recovered.participantId, recovered.sessionToken); return response; }
  catch (error) { return apiError(error); }
}
