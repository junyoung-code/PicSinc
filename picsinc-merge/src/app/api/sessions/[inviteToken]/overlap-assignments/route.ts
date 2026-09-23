import { NextResponse } from "next/server";
import { apiError, credentials, service } from "../../session-api";
export async function PUT(request: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  try { const { inviteToken } = await params; const credential = await credentials(inviteToken); const body = await request.json(); if (!Array.isArray(body.assignments)) return NextResponse.json({ error: "겹침 지정 목록이 필요합니다." }, { status: 400 }); const version = await service().saveOverlapAssignments({ inviteToken, participantId: credential.participantId, sessionToken: credential.sessionToken, assignments: body.assignments, expectedVersion: body.expectedVersion }); return NextResponse.json({ version }); }
  catch (error) { return apiError(error); }
}
