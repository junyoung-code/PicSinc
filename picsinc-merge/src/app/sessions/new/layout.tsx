import type { Metadata } from "next";
import type { ReactNode } from "react";

const title = "MOIRA — 함께 보정한 사진을 한 장으로";
const description = "사진 보정방을 만들고 친구들과 각자 보정한 부분을 한 장으로 모아보세요.";

export const metadata: Metadata = {
  metadataBase: new URL("https://moira.io.kr"),
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "MOIRA",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/images/moira-splash-poster.webp", width: 1920, height: 1080, alt: "MOIRA 사진 보정방 만들기" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/images/moira-splash-poster.webp"],
  },
};

export default function NewSessionLayout({ children }: { children: ReactNode }) {
  return children;
}
