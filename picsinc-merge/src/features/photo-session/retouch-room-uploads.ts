import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiError, service, setCredentials } from '@/app/api/sessions/session-api';
import { runHeavyTask } from '@/core/heavy-task';
import { SupabaseDirectUploadFiles, SupabaseDirectUploadRepository } from '@/integrations/storage/direct-uploads';
import { SupabasePhotoSessionStore } from '@/integrations/storage/supabase-photo-session-store';
import { DirectUploadService, type UploadIntent } from './direct-uploads-service';
import { createSecretToken } from './tokens';
import { fail } from './errors';
import type { VerifiedImage } from './image-validation';
import { validateDimensions } from '@/features/face-retouch/image-io/headers';

// Only the dedicated creation endpoint can mark an original as a retouch room.
// The original asset trigger consumes this marker in the creation transaction.
class RetouchUploadRepository extends SupabaseDirectUploadRepository {
  override async insert(intent: UploadIntent) {
    const retouchIntent = { ...intent, retouch_room: true };
    return super.insert(retouchIntent);
  }
  override async find(id: string) {
    const intent = await super.find(id) as (UploadIntent & { retouch_room?: boolean }) | null;
    if (intent && (!intent.retouch_room || intent.kind !== 'original')) fail(403, '공동 보정방 업로드가 아닙니다.');
    return intent;
  }
  override async finalize(intent: UploadIntent, ownerHash: string, leaseToken: string, image: VerifiedImage) {
    try { validateDimensions(image.width, image.height); }
    catch (error) { fail(400, (error as Error).message); }
    return super.finalize(intent, ownerHash, leaseToken, image);
  }
}

const bootstrapCookie = 'picsinc_upload_owner';
function uploads() {
  const secret = process.env.UPLOAD_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new Error('UPLOAD_SIGNING_SECRET is required');
  return new DirectUploadService(new RetouchUploadRepository(), new SupabaseDirectUploadFiles(), service(), new SupabasePhotoSessionStore(), secret);
}

export async function prepareRetouchRoom(request: Request) {
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) fail(400, 'JSON 요청이 필요합니다.');
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '요청 형식이 올바르지 않습니다.');
    const bootstrap = (await cookies()).get(bootstrapCookie)?.value || createSecretToken();
    const prepared = await uploads().prepareOriginalUpload(typeof value.nickname === 'string' ? value.nickname : '', {
      contentType: typeof value.contentType === 'string' ? value.contentType : '',
      size: typeof value.size === 'number' ? value.size : NaN,
    }, bootstrap);
    const response = NextResponse.json(prepared, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(bootstrapCookie, bootstrap, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 2 * 60 * 60 });
    return response;
  } catch (error) { return apiError(error); }
}

export async function completeRetouchRoom(_request: Request, uploadId: string) {
  try {
    const bootstrap = (await cookies()).get(bootstrapCookie)?.value;
    const result = await runHeavyTask(() => uploads().completeUpload(uploadId, bootstrap));
    if (result.kind !== 'original') fail(400, '원본 사진이 필요합니다.');
    const shareUrl = `/retouch/rooms/${result.session.inviteToken}`;
    const response = NextResponse.json({ session: result.session, participant: result.participant, shareUrl,
      recoveryUrl: `${shareUrl}/recover#token=${result.recoveryToken}`,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    setCredentials(response, result.session.inviteToken, result.participant.id, result.sessionToken);
    return response;
  } catch (error) { return apiError(error); }
}
