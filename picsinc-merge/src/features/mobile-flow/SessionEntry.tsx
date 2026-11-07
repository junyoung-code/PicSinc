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
import { DeletedRoomScreen } from './room-deletion';
import styles from '@/features/retouch-room-flow/room.module.css';

export default function SessionEntry({ inviteToken }: { inviteToken: string }) {
  const retouchRoom = usePathname().startsWith("/retouch/rooms/");
  const [loaded, setLoaded] = useState<{snapshot: FlowSnapshot; room: CollaborationView} | null>(null);
  const [expired, setExpired] = useState(false);
  const [deleted, setDeleted] = useState(false), [closed, setClosed] = useState(false);
  const [joined, setJoined] = useState(false);
  const [join, setJoin] = useState(false), [nickname, setNickname] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const base = `/api/sessions/${encodeURIComponent(inviteToken)}`;
  async function load() {
    const snapshot = await request<FlowSnapshot>(base);
    const room = await request<CollaborationView>(`${base}/collaboration`);
    setLoaded({ snapshot, room }); setJoin(false); setError("");
  }
  function report(e: unknown) {
    if (e instanceof RequestError && e.code === 'SESSION_DELETED') { setDeleted(true); setJoin(false); }
    else if (e instanceof RequestError && e.status === 409) { setClosed(true); setJoin(false); }
    else if (e instanceof RequestError && e.status === 410) { setExpired(true); setJoin(false); }
    else if (e instanceof RequestError && e.status === 403) { setJoin(true); setError(''); return; }
    setError((e as Error).message);
  }
  useEffect(() => { setLoaded(null); setJoin(false); setJoined(false); setExpired(false); setDeleted(false); setClosed(false); setError(""); void load().catch(report); }, [base]);
  async function participate() {
    if (busy || !nickname.trim()) return;
    setBusy(true); setError("");
    try {
      if (joined) { await load(); return; }
      const form = new FormData(); form.set("nickname", nickname.trim());
      const participantsUrl = retouchRoom ? `/api/retouch/rooms/${encodeURIComponent(inviteToken)}/participants` : `${base}/participants`;
      const result = await request<{recoveryUrl: string}>(participantsUrl, { method: "POST", body: form });
      rememberRecovery(inviteToken, result.recoveryUrl); setJoined(true); await load();
    } catch (e) { report(e); } finally { setBusy(false); }
  }
  if (deleted) return <DeletedRoomScreen/>;
  if (closed) return <MobileShell title="초대가 마감됐어요" hideBack footer={<a className="primary-button" href="/retouch/rooms/new">새 보정방 만들기</a>}><div className={styles.heading}><h1>이 보정방은<br/>이미 시작됐어요.</h1><p className="description">참여 인원이 확정되어<br/>새로운 친구는 입장할 수 없어요.</p></div><div className={styles.infoCard}><strong>이미 참여한 친구인가요?</strong><p>처음 참여했던 브라우저와 기기에서<br/>기존 링크로 다시 접속해 주세요.</p></div></MobileShell>;
  if (expired) return <MobileShell title="보정방 만료" hideBack footer={<a className="primary-button" href="/retouch/rooms/new">새 보정방 만들기</a>}><div className={styles.heading}><h1>보정방이 만료됐어요</h1><p className="description">방 생성 후 24시간이 지났어요.</p></div></MobileShell>;
  if (loaded && !loaded.room.enabled && retouchRoom) return <MobileShell title="MOIRA 보정방"><h1>공동 보정방 주소를 확인해주세요</h1><p className="description">이 주소의 방은 공동 보정방이 아니에요. 초대받은 주소를 확인하거나 새 공동 보정방을 만들어주세요.</p><a href="/retouch/rooms/new">새 보정방 만들기</a></MobileShell>;
  if (loaded) return loaded.room.enabled ? <CollaborativeRoom inviteToken={inviteToken} initialSnapshot={loaded.snapshot} initialRoom={loaded.room}/> : <SessionFlow inviteToken={inviteToken}/>;
  return <MobileShell title="친구와 함께 보정하기" hideBack showProgress={join} progress={10} footer={join ? <button className="primary-button" disabled={busy || !nickname.trim()} onClick={() => void participate()}>{busy ? "참여하는 중…" : "이 보정방에 참여하기"}</button> : undefined}>
    <div className={styles.heading}><h1>{join ? "함께 찍은 사진,\n내 얼굴은 내가 보정해요." : "보정방을 불러오고 있어요"}</h1>{join && <p className="description">닉네임을 입력하고<br/>친구들과 함께 보정방에 참여해요.</p>}</div>
    {join && <><div className={styles.inviteCard}><img src="/images/figma-current/character-photo.png" alt="MOIRA 친구들"/><div><strong>초대받은 보정방</strong><p>앱 설치 없이 함께 보정해요.<br/>완성 사진을 함께 저장해요.</p></div></div><form onSubmit={e => { e.preventDefault(); void participate(); }}><label className="name-field">내 닉네임<input value={nickname} onChange={e => setNickname(e.target.value)} maxLength={40} required autoComplete="nickname" placeholder="친구들이 알아볼 이름"/></label><p className={styles.fieldHint}>친구들이 알아볼 수 있는 이름을 사용해 주세요.</p></form></>}
    <StatusMessage message={error}/>{error && !join && <button className="secondary-button" onClick={() => void load().catch(report)}>다시 불러오기</button>}
  </MobileShell>;
}
