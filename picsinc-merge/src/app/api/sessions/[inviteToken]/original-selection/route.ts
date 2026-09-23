import { NextResponse } from "next/server";
import { apiError, credentials, service } from "../../session-api";

export async function PUT(request: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  try {
    const { inviteToken } = await params;
    const credential = await credentials(inviteToken);
    const body = await request.json();
    const version = await service().saveOriginalSelection({ inviteToken, ...credential, maskAssetId: body.maskAssetId, selectedRegionIds: body.selectedRegionIds, expectedVersion: body.expectedVersion });
    return NextResponse.json({ version });
  } catch (error) { return apiError(error); }
}
