import { completeRetouchRoom } from '@/features/photo-session/retouch-room-uploads';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  return completeRetouchRoom(request, (await params).uploadId);
}
