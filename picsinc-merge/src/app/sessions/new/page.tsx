"use client";
import { useState } from "react";
import MobileShell, { PhotoPicker, StatusMessage } from "@/components/mobile-shell";
import SplashScreen from "@/components/splash-screen";
import { photoError, rememberRecovery, usePreview } from "@/features/mobile-flow/client";
import { uploadOriginal } from "@/core/remote-client";

export default function NewSessionPage() {
  const [showSplash, setShowSplash] = useState(true);
  const [step, setStep] = useState<"name" | "photo">("name");
  const [nickname, setNickname] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const preview = usePreview(file);
  function pick(next: File | null) { const error = next ? photoError(next) : ""; setMessage(error); setFile(error ? null : next); }
  async function create() {
    if (!file || busy || !nickname.trim()) return;
    setBusy(true); setMessage("");
    try {
      const body = await uploadOriginal(nickname.trim(), file);
      rememberRecovery(body.session.inviteToken, body.recoveryUrl);
      location.assign(`${body.shareUrl}?step=invite`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "보정방을 만들지 못했어요."); setBusy(false); }
  }
  if (showSplash) return <SplashScreen onComplete={() => setShowSplash(false)} />;
  return <MobileShell variant={step === "name" ? "moira-name" : "moira-upload"} showProgress={false} helpTopic={step === "name" ? "start" : "original"} title={step === "name" ? "시작하기" : "원본 사진 올리기"} progress={step === "name" ? 16 : 32} onBack={step === "photo" && !busy ? () => setStep("name") : undefined} footer={step === "name" ?
    <button className="primary-button" disabled={!nickname.trim()} onClick={() => { setStep("photo"); setMessage(""); }}>원본 사진 올리기</button> :
    <button className="primary-button" disabled={!file || busy} onClick={() => void create()}>{busy ? "보정방을 만들고 있어요…" : "이 사진으로 보정방 만들기"}</button>}>
    {step === "name" ? <><div className="intro"><h1>방을 만들고<br />친구들을 초대해요</h1><p className="description">원본 사진을 올리고 초대 링크를 보내면,<br />친구들과 각자의 얼굴을 함께 보정할 수 있어요.</p></div><form onSubmit={event => { event.preventDefault(); if (nickname.trim()) setStep("photo"); }}><label className="name-field host-name-field">대표자 이름<input value={nickname} onChange={event => setNickname(event.target.value)} placeholder="친구들이 알아볼 이름" autoComplete="nickname" maxLength={40} required /></label></form></> :
    <><h1>모두가 보정할<br />원본을 올려주세요</h1><p className="description">얼굴이 선명하게 나온 원본을 그대로 올려주세요.</p><PhotoPicker file={file} preview={preview} label="원본 사진 선택" onChange={pick} busy={busy} /></>}
    <StatusMessage message={message} />
  </MobileShell>;
}
