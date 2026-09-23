"use client";
import { useEffect, useRef, useState } from "react";
import MobileShell from "@/components/mobile-shell";
import { rememberRecovery } from "@/features/mobile-flow/client";
export default function RecoveryPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const [message, setMessage] = useState("복구 중입니다.");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const recovery = useRef<{ inviteToken: string; token: string } | null>(null);
  async function recover() {
    if (!recovery.current || busy) return;
    setBusy(true); setMessage("복구 중입니다.");
    const { inviteToken, token } = recovery.current;
    try {
      const response = await fetch(`/api/sessions/${inviteToken}/recover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      rememberRecovery(inviteToken, `${location.origin}/sessions/${inviteToken}/recover#token=${token}`);
      location.assign(`/sessions/${inviteToken}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "복구하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (started.current) return; started.current = true;
    void params.then(({ inviteToken }) => {
      const token = new URLSearchParams(location.hash.slice(1)).get("token");
      history.replaceState(null, "", location.pathname);
      if (!token) { setMessage("복구 링크가 올바르지 않습니다. 받은 링크 전체를 다시 열어 주세요."); return; }
      recovery.current = { inviteToken, token }; void recover();
    });
  }, [params]);
  return <MobileShell title="내 작업 이어가기"><h1>저장한 작업으로<br />돌아가고 있어요</h1><p className="status-message" role="status">{message}</p>{recovery.current && !busy && <button className="primary-button" onClick={() => void recover()}>복구 다시 시도</button>}</MobileShell>;
}
