'use client';
import { useEffect, useRef, useState } from 'react';
import { StatusMessage } from '@/components/mobile-shell';
import MobileShell from '@/features/retouch-room-flow/RetouchShell';
import { jsonRequest, rememberRecovery, request } from '@/features/mobile-flow/client';

export default function RecoverRetouchRoom({ inviteToken }: { inviteToken: string }) {
  const token = useRef(''), started = useRef(false), pending = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('참여증을 확인하고 있어요.');
  async function recover() {
    if (!token.current || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      await request(`/api/sessions/${encodeURIComponent(inviteToken)}/recover`, jsonRequest({ token: token.current }));
      const base = `/retouch/rooms/${encodeURIComponent(inviteToken)}`;
      rememberRecovery(inviteToken, `${base}/recover#token=${token.current}`);
      location.assign(base);
    } catch (error) { setMessage((error as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (started.current) return; started.current = true;
    token.current = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    history.replaceState(null, '', location.pathname);
    if (!token.current) { setMessage('복구 링크가 올바르지 않습니다. 받은 링크 전체를 다시 열어 주세요.'); return; }
    void recover();
  }, [inviteToken]);
  return <MobileShell title="공동 보정 이어가기" showProgress={false}><h1>저장한 보정방으로<br/>돌아가고 있어요</h1><StatusMessage message={message}/>{token.current && !busy && <button className="primary-button" onClick={() => void recover()}>복구 다시 시도</button>}</MobileShell>;
}
