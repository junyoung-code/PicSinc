"use client";

const markerKey = "picsinc_festival_test";
const eventsKey = "picsinc_festival_uploads";
export type FestivalUploadMetric = { uploadId: string; prepareMs: number; storageMs: number;
  completeMs: number; totalMs: number; status: "ready" | "failed" };

export function festivalTestActive() {
  if (typeof window === "undefined") return false;
  try {
    const marker = new URLSearchParams(window.location.search).get("festivalTest");
    if (marker && /^[A-Za-z0-9-]{3,20}$/.test(marker)) localStorage.setItem(markerKey, marker);
    return Boolean(localStorage.getItem(markerKey));
  } catch { return false; }
}

export function recordFestivalUpload(metric: FestivalUploadMetric) {
  if (!festivalTestActive()) return;
  try {
    const old = JSON.parse(localStorage.getItem(eventsKey) || "[]") as FestivalUploadMetric[];
    const events = Array.isArray(old) ? old.filter(item => item.uploadId !== metric.uploadId) : [];
    events.push(metric);
    localStorage.setItem(eventsKey, JSON.stringify(events.slice(-100)));
  } catch { /* Test recording must never block an upload. */ }
}

export function exportFestivalUploads() {
  if (!festivalTestActive()) return;
  let events: FestivalUploadMetric[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(eventsKey) || "[]");
    if (Array.isArray(stored)) events = stored;
  } catch { /* Export an empty recording if local storage was corrupted. */ }
  const object = URL.createObjectURL(new Blob([JSON.stringify({ events }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = object; link.download = "picsinc-original-upload-measurements.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(object), 1000);
}

export function stopFestivalRecording() {
  try { localStorage.removeItem(markerKey); localStorage.removeItem(eventsKey); } catch { /* Nothing to clear. */ }
}
