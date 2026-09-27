import type { Metadata } from "next";
import type { ReactNode } from "react";

const title = "PicSync — 함께 보정한 사진을 한 장으로";
const description = "사진 보정방을 만들고 친구들과 각자 보정한 부분을 한 장으로 모아보세요.";

export const metadata: Metadata = {
  metadataBase: new URL("https://picsinc-merge.vercel.app"),
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "PicSync",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/images/site-card.png", width: 1200, height: 630, alt: "PicSync 사진 보정방 만들기" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/images/site-card.png"],
  },
};

export default function NewSessionLayout({ children }: { children: ReactNode }) {
  return children;
}
