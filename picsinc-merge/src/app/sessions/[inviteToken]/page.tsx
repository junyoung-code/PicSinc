import type { Metadata } from "next";
import SessionFlow from "@/features/mobile-flow/SessionFlow";

const inviteTitle = "MOIRA 사진 보정방에 초대받았어요";
const inviteDescription = "각자 보정한 사진을 올리고, 마음에 드는 부분을 한 장으로 모아보세요.";

export const metadata: Metadata = {
  metadataBase: new URL("https://moira.io.kr"),
  title: inviteTitle,
  description: inviteDescription,
  openGraph: {
    title: inviteTitle,
    description: inviteDescription,
    siteName: "MOIRA",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/images/moira-splash-poster.webp", width: 1920, height: 1080, alt: "MOIRA 사진 보정방 초대" }],
  },
  twitter: {
    card: "summary_large_image",
    title: inviteTitle,
    description: inviteDescription,
    images: ["/images/moira-splash-poster.webp"],
  },
};

export default async function SessionPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  return <SessionFlow inviteToken={inviteToken} />;
}
