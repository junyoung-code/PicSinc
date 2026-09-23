import { NextResponse } from "next/server";
import { apiError, recoveryUrl, service, setCredentials } from "../../session-api";
export async function POST(request: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  try { const { inviteToken } = await params; const form = await request.formData(); const joined = await service().join(inviteToken, String(form.get("nickname") ?? "")); const response = NextResponse.json({ participant: joined.participant, recoveryUrl: recoveryUrl(request, inviteToken, joined.recoveryToken) }, { status: 201 }); setCredentials(response, inviteToken, joined.participant.id, joined.sessionToken); return response; }
  catch (error) { return apiError(error); }
}
