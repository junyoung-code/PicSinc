import { NextResponse } from 'next/server';
import { collaboration } from '@/features/photo-session/collaboration';
import { readCollaborationRequest } from '@/features/photo-session/collaboration-request';
import type { CollaborationAction } from '@/features/photo-session/collaboration-types';
import { apiError, credentials } from '../../session-api';
export const maxDuration=60;
export async function GET(_: Request,{params}:{params:Promise<{inviteToken:string}>}) {
  try { const {inviteToken}=await params; return NextResponse.json(await collaboration({inviteToken,...await credentials(inviteToken)},{action:'read'}), {headers:{'Cache-Control':'no-store'}}); }
  catch(error) { return apiError(error); }
}
export async function POST(request: Request,{params}:{params:Promise<{inviteToken:string}>}) {
  try {
    const {inviteToken}=await params;
    const auth={inviteToken,...await credentials(inviteToken)};
    return NextResponse.json(await collaboration(auth,await readCollaborationRequest(request) as CollaborationAction));
  } catch(error) { return apiError(error); }
}
