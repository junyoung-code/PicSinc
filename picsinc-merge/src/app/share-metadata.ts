import type { Metadata } from "next";

// Link previews (KakaoTalk, iMessage, etc.) read Open Graph tags, not <meta name="description">.
// Without og:description KakaoTalk shows "여기를 눌러 링크를 확인하세요." and no image.
// Never put room photos or participant names here: anyone with the link sees the preview.
const image = { url: "/images/moira-share-card.png", width: 1200, height: 630, alt: "MOIRA" };

export function shareMetadata(title: string, description: string): Metadata {
  return {
    metadataBase: new URL("https://moira.io.kr"),
    title,
    description,
    openGraph: { title, description, siteName: "MOIRA", locale: "ko_KR", type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
