import SessionEntry from '@/features/mobile-flow/SessionEntry';
export default async function RetouchRoomPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  return <SessionEntry inviteToken={(await params).inviteToken} />;
}
