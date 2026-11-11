import type { Metadata } from "next";
import SessionFlow from "@/features/mobile-flow/SessionFlow";
import { shareMetadata } from "@/app/share-metadata";

export const metadata: Metadata = shareMetadata("MOIRA 사진 보정방에 초대받았어요", "각자 보정한 사진을 올리고, 마음에 드는 부분을 한 장으로 모아보세요.");

export default async function SessionPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  return <SessionFlow inviteToken={inviteToken} />;
}
