"use client";
import { useEffect, useState } from "react";

export class RequestError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(body?.error ?? "요청을 처리하지 못했어요. 다시 시도해 주세요.", response.status, body?.code);
  return body as T;
}
export const jsonRequest = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export function photoError(file: File): string {
  if (!["image/jpeg", "image/png"].includes(file.type)) return "JPG 또는 PNG 사진을 선택해 주세요. HEIC 사진은 JPG로 변환한 뒤 올려 주세요.";
  if (file.size > 20 * 1024 * 1024) return "20MB 이하의 사진을 선택해 주세요.";
  return "";
}
export function usePreview(file: File | null) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!file) { setUrl(""); return; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url;
}
export function rememberRecovery(token: string, url: string) {
  // Browser storage can be unavailable; cookie authentication still works.
  try { sessionStorage.setItem(`picsinc-recovery:${token}`, new URL(url, location.origin).toString()); } catch { /* optional convenience only */ }
}
export function savedRecovery(token: string) { try { return sessionStorage.getItem(`picsinc-recovery:${token}`) ?? ""; } catch { return ""; } }
