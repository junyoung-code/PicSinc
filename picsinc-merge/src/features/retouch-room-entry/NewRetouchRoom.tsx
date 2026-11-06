'use client';
import { useRef, useState } from 'react';
import { PhotoPicker, StatusMessage } from '@/components/mobile-shell';
import MobileShell from '@/features/retouch-room-flow/RetouchShell';
import WindowBar from '@/features/home/WindowBar';
import styles from '@/features/retouch-room-flow/room.module.css';
import { photoError, rememberRecovery, usePreview } from '@/features/mobile-flow/client';
import { encodedSize, validateDimensions } from '@/features/face-retouch/image-io/headers';
import { sendUpload } from '@/core/remote-client';

export default function NewRetouchRoom() {
  const [nickname, setNickname] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const pickVersion = useRef(0);
  const preview = usePreview(file);
  async function pick(next: File | null) {
    const version = ++pickVersion.current;
    setFile(null); setMessage(''); setChecking(!!next);
    try {
      if (!next) return;
      const error = photoError(next); if (error) throw new Error(error);
      const { width, height } = encodedSize(new Uint8Array(await next.arrayBuffer()), next.type);
      validateDimensions(width, height);
      if (version === pickVersion.current) setFile(next);
    } catch (error) { if (version === pickVersion.current) setMessage((error as Error).message); }
    finally { if (version === pickVersion.current) setChecking(false); }
  }
  async function create() {
    if (!file || !nickname.trim() || busy || checking) return;
    setBusy(true); setMessage('');
    try {
      const result = await sendUpload('/api/retouch/uploads', file, { nickname: nickname.trim() }, {}, '/api/retouch/uploads');
      rememberRecovery(result.session.inviteToken, result.recoveryUrl);
      location.assign(result.shareUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : '보정방을 만들지 못했어요. 다시 시도해 주세요.'); setBusy(false); }
  }
  return <MobileShell title="공동 보정방 만들기" showProgress={false} backDisabled={busy} onBack={() => location.assign('/retouch')}
    footer={<button className="primary-button" disabled={busy || checking || !file || !nickname.trim()} onClick={() => void create()}>{busy ? '보정방을 만들고 있어요…' : '공동 보정방 만들기'}</button>}>
    <span className={styles.badge}>친구들과, 한 장으로</span>
    <h1>각자 마음에 들게,<br/>한 장에 모이게.</h1>
    <p className="description">사진 한 장을 올리고<br/>친구들과 내 얼굴만 보정해요.</p>
    <div className={styles.photoWindow}>
      <WindowBar title="our_photo.png" />
      <PhotoPicker file={file} preview={preview} label="원본 사진 선택" onChange={next => void pick(next)} busy={busy} />
      <img className={styles.lilac} src="/images/home/lilac.png" width="72" height="72" alt="" />
      <img className={styles.pink} src="/images/home/pink.png" width="70" height="70" alt="" />
    </div>
    <label className="name-field">대표자 이름<input value={nickname} onChange={event => setNickname(event.target.value)} disabled={busy} maxLength={40} autoComplete="nickname" placeholder="친구들이 알아볼 이름" required /></label>
    <StatusMessage message={checking ? '사진 크기를 확인하고 있어요…' : message} />
    <div className={styles.steps}><span>01 사진 올리기</span><span>02 친구 초대</span><span>03 함께 보정</span></div>
  </MobileShell>;
}
