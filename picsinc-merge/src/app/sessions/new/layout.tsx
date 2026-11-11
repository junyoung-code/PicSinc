import type { Metadata } from "next";
import type { ReactNode } from "react";
import { shareMetadata } from "@/app/share-metadata";

export const metadata: Metadata = shareMetadata("MOIRA — 함께 보정한 사진을 한 장으로", "사진 보정방을 만들고 친구들과 각자 보정한 부분을 한 장으로 모아보세요.");

export default function NewSessionLayout({ children }: { children: ReactNode }) {
  return children;
}
