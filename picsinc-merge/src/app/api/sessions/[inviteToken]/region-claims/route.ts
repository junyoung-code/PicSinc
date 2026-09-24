import { NextResponse } from "next/server";
import { apiError, credentials, service } from "../../session-api";

type Context = { params: Promise<{ inviteToken: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { inviteToken } = await params;
    const claims = await service().regionClaims({ inviteToken, ...await credentials(inviteToken) });
    return NextResponse.json({ claims }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { inviteToken } = await params;
    const credential = await credentials(inviteToken);
    const body = await request.json();
    const claims = await service().setRegionClaim({ inviteToken, ...credential, regionId: body?.regionId, selected: body?.selected });
    return NextResponse.json({ claims });
  } catch (error) { return apiError(error); }
}
