import { NextResponse } from "next/server";
import { apiError, service } from "../../session-api";
export async function GET(_: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  try {
    const { inviteToken } = await params;
    return NextResponse.json(await service().roomStatus(inviteToken), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
