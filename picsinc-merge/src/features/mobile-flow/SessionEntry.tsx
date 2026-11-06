"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { StatusMessage } from "@/components/mobile-shell";
import MobileShell from "@/features/retouch-room-flow/RetouchShell";
import type { CollaborationView } from "@/features/photo-session/collaboration-types";
import { request, RequestError, rememberRecovery } from "./client";
import type { FlowSnapshot } from "./flow-state";
import SessionFlow from "./SessionFlow";
import CollaborativeRoom from "./CollaborativeRoom";

export default function SessionEntry({ inviteToken }: { inviteToken: string }) {
  const retouchRoom = usePathname().startsWith("/retouch/rooms/");
  const [loaded, setLoaded] = useState<{snapshot: FlowSnapshot; room: CollaborationView} | null>(null);
  const [expired, setExpired] = useState(false);
  const [join, setJoin] = useState(false), [nickname, setNickname] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const base = `/api/sessions/${encodeURIComponent(inviteToken)}`;
  async function load() {
    const snapshot = await request<FlowSnapshot>(base);
    const room = await request<CollaborationView>(`${base}/collaboration`);
    setLoaded({ snapshot, room }); setJoin(false); setError("");
  }
  function report(e: unknown) {
    if (e instanceof RequestError && e.status === 410) { setExpired(true); setJoin(false); }
    else if (e instanceof RequestError && e.status === 403) setJoin(true);
    setError((e as Error).message);
  }
  useEffect(() => { setLoaded(null); setJoin(false); setExpired(false); setError(""); void load().catch(report); }, [base]);
  async function participate() {
    if (busy || !nickname.trim()) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("nickname", nickname.trim());
      const participantsUrl = retouchRoom ? `/api/retouch/rooms/${encodeURIComponent(inviteToken)}/participants` : `${base}/participants`;
      const result = await request<{recoveryUrl: string}>(participantsUrl, { method: "POST", body: form });
      rememberRecovery(inviteToken, result.recoveryUrl); await load();
    } catch (e) { report(e); } finally { setBusy(false); }
  }
  if (expired) return <MobileShell title="보정방 만료"><h1>보정방이 만료됐어요</h1><p>방 생성 후 24시간이 지났어요.</p><a href="/retouch/rooms/new">새 보정방 만들기</a></MobileShell>;
  if (loaded && !loaded.room.enabled && retouchRoom) return <MobileShell title="MOIRA 보정방"><h1>공동 보정방 주소를 확인해주세요</h1><p className="description">이 주소의 방은 공동 보정방이 아니에요. 초대받은 주소를 확인하거나 새 공동 보정방을 만들어주세요.</p><a href="/retouch/rooms/new">새 보정방 만들기</a></MobileShell>;
  if (loaded) return loaded.room.enabled ? <CollaborativeRoom inviteToken={inviteToken} initialSnapshot={loaded.snapshot} initialRoom={loaded.room}/> : <SessionFlow inviteToken={inviteToken}/>;
  return <MobileShell title="MOIRA 보정방" footer={join ? <button className="primary-button" disabled={busy || !nickname.trim()} onClick={() => void participate()}>{busy ? "참여하는 중…" : "참여하기"}</button> : undefined}>
    <h1>{join ? "내 얼굴은 내가,\n함께 보정해요" : "보정방을 불러오고 있어요"}</h1>
    {join && <form onSubmit={e => { e.preventDefault(); void participate(); }}><p className="description">친구들이 모인 뒤 대표자가 얼굴 인식을 시작해요.<br/>인식 시작 후에는 새로 참여할 수 없어요.</p><label className="name-field">내 이름<input value={nickname} onChange={e => setNickname(e.target.value)} maxLength={40} required autoComplete="nickname"/></label></form>}
    <StatusMessage message={error}/>{error && !join && <button className="secondary-button" onClick={() => void load().catch(report)}>다시 불러오기</button>}
  </MobileShell>;
}
