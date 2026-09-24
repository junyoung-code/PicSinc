import { NextResponse } from "next/server";
import { apiError, credentials, service } from "../session-api";
export async function GET(_: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  try { const { inviteToken } = await params; const credential = await credentials(inviteToken); const snapshot = await service().snapshot(inviteToken, credential.participantId, credential.sessionToken); return NextResponse.json({ ...snapshot, currentParticipantId: credential.participantId, assets: snapshot.assets.map(({ storageKey: _storageKey, ...asset }) => asset) }); }
  catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  try {
    const { inviteToken } = await params;
    const credential = await credentials(inviteToken);
    await service().deleteRoom(inviteToken, credential.participantId, credential.sessionToken);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
