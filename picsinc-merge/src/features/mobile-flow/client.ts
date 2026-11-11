"use client";
import { useEffect, useState } from "react";

export class RequestError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
// fetch rejects with an English TypeError ("Failed to fetch") when offline, and screens show
// error.message as is. Keep it a TypeError so existing network-retry checks still match.
export const networkErrorMessage = "인터넷 연결이 끊겼어요. 연결을 확인해 주세요.";
export const timeoutErrorMessage = "응답이 늦어지고 있어요. 연결을 확인하고 다시 시도해 주세요.";
export class NetworkError extends TypeError { constructor(message = networkErrorMessage) { super(message); this.name = "NetworkError"; } }
// A read that hangs with no answer (weak signal, server restarting) would otherwise leave screens
// on "불러오고 있어요" forever with no retry button. Only reads get a limit: writes such as uploads
// can legitimately take long, and their retries are handled elsewhere.
export const readTimeoutMs = 20_000;
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const read = !init?.method || init.method.toUpperCase() === "GET";
  const limit = read && !init?.signal ? new AbortController() : null;
  const timer = limit ? setTimeout(() => limit.abort(), readTimeoutMs) : null;
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store", ...(limit ? { signal: limit.signal } : {}) }); }
  catch (error) {
    if (limit?.signal.aborted) throw new NetworkError(timeoutErrorMessage);
    throw error instanceof TypeError ? new NetworkError() : error;
  }
  finally { if (timer) clearTimeout(timer); }
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
