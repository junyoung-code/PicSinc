import { joinRetouchRoom, leaveRetouchRoom } from '@/features/photo-session/retouch-room-participants';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  return joinRetouchRoom(request, (await params).inviteToken);
}
export async function DELETE(_: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  return leaveRetouchRoom((await params).inviteToken);
}
