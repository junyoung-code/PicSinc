import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import FestivalMetricExport from "@/features/mobile-flow/FestivalMetricExport";
import FestivalVisitTracker from "@/features/mobile-flow/FestivalVisitTracker";
import { shareMetadata } from "./share-metadata";
import "./globals.css";

export const metadata: Metadata = shareMetadata("MOIRA — 함께 만드는 한 장", "각자 마음에 드는 보정 부분을 한 장의 사진으로 모으세요.");

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}<FestivalVisitTracker /><FestivalMetricExport /></body></html>;
}
