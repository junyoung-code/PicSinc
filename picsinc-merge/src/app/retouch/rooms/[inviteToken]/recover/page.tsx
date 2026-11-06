import RecoverRetouchRoom from '@/features/retouch-room-entry/RecoverRetouchRoom';
export default async function RecoverPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  return <RecoverRetouchRoom inviteToken={(await params).inviteToken}/>;
}
