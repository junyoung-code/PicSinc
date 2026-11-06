import type { Metadata } from "next";
import FeatureHome from "@/features/home/FeatureHome";

export const metadata: Metadata = { title: "MOIRA — 각자의 보정을 한 장으로" };

export default function HomePage() {
  return <FeatureHome />;
}
