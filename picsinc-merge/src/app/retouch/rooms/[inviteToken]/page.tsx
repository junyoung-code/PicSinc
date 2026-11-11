import type { Metadata } from 'next';
import SessionEntry from '@/features/mobile-flow/SessionEntry';
import { shareMetadata } from '@/app/share-metadata';

export const metadata: Metadata = shareMetadata('MOIRA 함께 보정방에 초대받았어요', '링크만 누르면 앱 없이 참여할 수 있어요. 각자 내 얼굴만 보정해 한 장으로 완성해요.');

export default async function RetouchRoomPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  return <SessionEntry inviteToken={(await params).inviteToken} />;
}
