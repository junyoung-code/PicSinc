"use client";

const key = "picsinc:visit-id";
let fallbackId: string | undefined;
export function visitId(): string {
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return fallbackId ??= crypto.randomUUID();
  }
}

export function deviceKind(): "mobile" | "tablet" | "desktop" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const agent = navigator.userAgent;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(agent)) return "tablet";
  if (/Mobile|iPhone|Android/i.test(agent)) return "mobile";
  return agent ? "desktop" : "unknown";
}

export function sendFestivalEvent(eventName: string, inviteToken?: string, extra: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  void fetch("/api/festival/events", {
    method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
    body: JSON.stringify({ eventName, inviteToken, visitId: visitId(), deviceKind: deviceKind(), ...extra }),
    keepalive: true,
  }).catch(() => undefined);
}
