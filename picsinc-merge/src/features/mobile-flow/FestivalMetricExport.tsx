"use client";

import { useEffect, useState } from "react";
import { exportFestivalUploads, festivalTestActive, stopFestivalRecording } from "@/core/festival-test-metrics";

export default function FestivalMetricExport() {
  const [active, setActive] = useState(false);
  useEffect(() => { setActive(festivalTestActive()); }, []);
  if (!active) return null;
  return <aside style={{ position: "fixed", zIndex: 1000, right: 12, bottom: 12, display: "flex", gap: 6,
    padding: 8, borderRadius: 10, background: "#17304e", boxShadow: "0 4px 14px #0004" }} aria-label="축제 시험 기록">
    <button type="button" onClick={exportFestivalUploads} style={{ padding: "6px 9px", borderRadius: 6, background: "#fff", color: "#17304e" }}>시험 기록 내려받기</button>
    <button type="button" onClick={() => { stopFestivalRecording(); setActive(false); }} style={{ padding: "6px 9px", borderRadius: 6, background: "#dbe7f4", color: "#17304e" }}>종료</button>
  </aside>;
}
