'use client';
import { useEffect, useRef, useState } from 'react';
import { PhotoPicker, StatusMessage } from '@/components/mobile-shell';
import MobileShell from '@/features/retouch-room-flow/RetouchShell';
import styles from '@/features/retouch-room-flow/room.module.css';
import { photoError, rememberRecovery, usePreview } from '@/features/mobile-flow/client';
import { encodedSize, validateDimensions } from '@/features/face-retouch/image-io/headers';
import { sendUpload } from '@/core/remote-client';

export default function NewRetouchRoom() {
  const [step, setStep] = useState<'name' | 'photo'>('name');
  const [nickname, setNickname] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const pickVersion = useRef(0);
  const preview = usePreview(file);
  const busyNow = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  // On a slow phone the name field shows before React starts; text typed in that gap is in the
  // field but not in state, so the next button stayed off. Pick it up once React is running.
  useEffect(() => { const typed = nameInput.current?.value; if (typed) setNickname(typed); }, []);
  // Both steps share one address, so the photo step gets its own history entry: the phone back
  // button then returns to the name step (name kept) instead of leaving for the home screen.
  useEffect(() => {
    function back(event: PopStateEvent) {
      if (event.state?.newRoomStep === 'photo') { setStep('photo'); return; }
      if (busyNow.current) { history.pushState({ newRoomStep: 'photo' }, '', location.href); return; }
      setStep('name');
    }
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, []);
  function toPhoto() {
    if (!nickname.trim()) return;
    if (history.state?.newRoomStep !== 'photo') history.pushState({ newRoomStep: 'photo' }, '', location.href);
    setStep('photo');
  }
  function toName() {
    if (history.state?.newRoomStep === 'photo') history.back(); else setStep('name');
  }
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
    setBusy(true); busyNow.current = true; setMessage('');
    try {
      const result = await sendUpload('/api/retouch/uploads', file, { nickname: nickname.trim() }, {}, '/api/retouch/uploads');
      rememberRecovery(result.session.inviteToken, result.recoveryUrl);
      location.assign(result.shareUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : '보정방을 만들지 못했어요. 다시 시도해 주세요.'); setBusy(false); busyNow.current = false; }
  }
  return <MobileShell title={step === 'name' ? 'MOIRA' : '원본 사진 올리기'} brand={step === 'name'} showProgress={step === 'photo'} progress={10} backDisabled={busy} onBack={step === 'photo' ? toName : undefined}
    footer={<button className="primary-button" disabled={busy || checking || !nickname.trim() || step === 'photo' && !file} onClick={() => step === 'name' ? toPhoto() : void create()}>{step === 'name' ? '원본 사진 올리기 →' : busy ? '보정방을 만들고 있어요…' : '이 사진으로 보정방 만들기'}</button>}>
    {step === 'name' ? <>
      <div className={styles.heading}><h1 className={styles.heroTitle}>다같이 찍은 사진<br/>다같이 보정하자</h1><p className="description">친구들과 실시간으로 모여서<br/>각자 얼굴만 보정해요.</p></div>
      <div className={styles.introArt} aria-hidden="true"><div className={styles.introPhoto}><img src="/images/figma-current/character-photo.png" alt="" /></div><strong>각자 보정<br/>같이 완성!</strong></div>
      <form onSubmit={event => { event.preventDefault(); toPhoto(); }}><label className="name-field">내 이름<input ref={nameInput} value={nickname} onChange={event => setNickname(event.target.value)} maxLength={40} autoComplete="nickname" placeholder="친구들이 알아볼 이름" required /></label></form>
      <div className={styles.steps}><span>01 방 준비</span><span>02 얼굴 선택</span><span>03 함께 보정</span><span>04 사진 완성</span></div>
    </> : <>
      <div className={styles.heading}><h1>모두가 보정할<br/>원본을 올려주세요</h1><p className="description">얼굴이 선명하게 나온 원본을 그대로 올려주세요.</p></div>
      <div className={styles.photoWindow}><PhotoPicker file={file} preview={preview} label="원본 사진 선택" onChange={next => void pick(next)} busy={busy} /></div>
      <StatusMessage message={checking ? '사진 크기를 확인하고 있어요…' : message} />
    </>}
  </MobileShell>;
}
