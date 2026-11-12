import 'server-only';
import { NextResponse } from 'next/server';
import { apiError, cookieName, credentials, setCredentials } from '@/app/api/sessions/session-api';
import { supabaseServer } from '@/integrations/storage/supabase-server';
import { SupabasePhotoSessionStore, SupabasePrivateFileStore } from '@/integrations/storage/supabase-photo-session-store';
import { PhotoSessionService } from './service';
import { authorizeProcessing } from './processing-service';
import { collaborationError } from './collaboration';
import { SessionError } from './errors';
import type { PhotoSessionStore } from './types';

class RetouchParticipantStore extends SupabasePhotoSessionStore {
  override async createParticipant(input: Parameters<PhotoSessionStore['createParticipant']>[0]) {
    const { participant, credentials } = input;
    const { error } = await supabaseServer().rpc('join_retouch_room', {
      p_session_id: participant.sessionId, p_participant_id: participant.id, p_nickname: participant.nickname,
      p_session_token_hash: credentials.sessionTokenHash, p_recovery_token_hash: credentials.recoveryTokenHash,
    });
    if (error?.message === 'Retouch room required') throw new SessionError(404, '공동 보정방 초대 링크를 확인해 주세요.', 'RETOUCH_ROOM_REQUIRED');
    collaborationError(error);
  }
}

export async function joinRetouchRoom(request: Request, inviteToken: string) {
  try {
    const form = await request.formData();
    const service = new PhotoSessionService(new RetouchParticipantStore(), new SupabasePrivateFileStore());
    const joined = await service.join(inviteToken, String(form.get('nickname') ?? ''));
    const response = NextResponse.json({ participant: joined.participant,
      recoveryUrl: `/retouch/rooms/${inviteToken}/recover#token=${joined.recoveryToken}`,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    setCredentials(response, inviteToken, joined.participant.id, joined.sessionToken);
    return response;
  } catch (error) { return apiError(error); }
}

// Lobby only: the DB removes the participant so the owner's list and the
// roster frozen by "start" no longer count them (B-042).
export async function leaveRetouchRoom(inviteToken: string) {
  try {
    const auth = { inviteToken, ...await credentials(inviteToken) };
    const session = await authorizeProcessing(auth);
    const { error } = await supabaseServer().rpc('leave_retouch_room', { p_session_id: session.id, p_participant_id: auth.participantId });
    if (error?.message === 'Retouch room required') throw new SessionError(404, '공동 보정방 초대 링크를 확인해 주세요.', 'RETOUCH_ROOM_REQUIRED');
    if (error?.message === 'Forbidden') throw new SessionError(403, '대표자는 보정방을 나갈 수 없어요.');
    collaborationError(error);
    const response = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.delete(cookieName(inviteToken));
    return response;
  } catch (error) { return apiError(error); }
}
