"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sendFestivalEvent } from "@/core/festival-visit";

export default function FestivalVisitTracker() {
  const path = usePathname();
  useEffect(() => {
    const match = /^\/sessions\/([^/]+)$/.exec(path);
    sendFestivalEvent("visit_started", match && match[1] !== "new" ? decodeURIComponent(match[1]) : undefined);
    if (match && match[1] !== "new") sendFestivalEvent("room_opened", decodeURIComponent(match[1]));
  }, [path]);
  return null;
}
