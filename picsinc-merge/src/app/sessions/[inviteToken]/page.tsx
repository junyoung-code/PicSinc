import type { Metadata } from "next";
import SessionFlow from "@/features/mobile-flow/SessionFlow";

const inviteTitle = "PicSync 사진 보정방에 초대받았어요";
const inviteDescription = "각자 보정한 사진을 올리고, 마음에 드는 부분을 한 장으로 모아보세요.";

export const metadata: Metadata = {
  metadataBase: new URL("https://picsinc-merge.vercel.app"),
  title: inviteTitle,
  description: inviteDescription,
  openGraph: {
    title: inviteTitle,
    description: inviteDescription,
    siteName: "PicSync",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/images/invite-card.png", width: 1200, height: 630, alt: "PicSync 사진 보정방 초대" }],
  },
  twitter: {
    card: "summary_large_image",
    title: inviteTitle,
    description: inviteDescription,
    images: ["/images/invite-card.png"],
  },
};

export default async function SessionPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  return <SessionFlow inviteToken={inviteToken} />;
}
