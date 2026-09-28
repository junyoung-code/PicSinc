"use client";
import { useEffect, useState } from "react";

export default function OperatorPage() {
  const [code, setCode] = useState("");
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/operator/test-mode").then(r => r.json()).then(v => setActive(v.active)).catch(() => setMessage("상태를 확인하지 못했습니다.")); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/operator/test-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    setCode(""); setActive(response.ok); setMessage(response.ok ? "이 브라우저에서 4시간 동안 시험 방을 만들 수 있습니다." : "운영자 코드를 확인해 주세요.");
  }
  async function clear() {
    const response = await fetch("/api/operator/test-mode", { method: "DELETE" });
    if (response.ok) { setActive(false); setMessage("시험 모드를 해제했습니다."); }
  }
  return <main style={{ maxWidth: 420, margin: "4rem auto", padding: 20 }}><h1>행사 시험 모드</h1><p>현재 브라우저: {active ? "시험 모드" : "일반 모드"}</p><form onSubmit={submit}><label>운영자 코드<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required minLength={32} /></label><button type="submit">시험 모드 켜기</button></form><button type="button" onClick={() => void clear()}>시험 모드 끄기</button><p role="status">{message}</p></main>;
}
