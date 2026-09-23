"use client";
import { useState } from "react";
import MobileShell, { Notice, PhotoPicker, StatusMessage } from "@/components/mobile-shell";
import { photoError, rememberRecovery, usePreview } from "@/features/mobile-flow/client";
import { uploadOriginal } from "@/core/remote-client";

export default function NewSessionPage() {
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
  return <MobileShell title={step === "name" ? "PicSync" : "원본 사진 올리기"} progress={step === "name" ? 16 : 32} onBack={step === "photo" && !busy ? () => setStep("name") : undefined} footer={step === "name" ?
    <button className="primary-button" disabled={!nickname.trim()} onClick={() => { setStep("photo"); setMessage(""); }}>다음 · 원본 사진 올리기</button> :
    <button className="primary-button" disabled={!file || busy} onClick={() => void create()}>{busy ? "보정방을 만들고 있어요…" : "이 사진으로 보정방 만들기"}</button>}>
    {step === "name" ? <><div className="intro"><p className="eyebrow">설치 없이 바로 시작</p><h1>친구들과 보정한 얼굴을<br />한 장으로 합쳐보세요</h1><p className="description">대표자가 원본을 올리고 링크를 공유하면<br />각자 보정한 사진을 제출할 수 있어요.</p></div><form onSubmit={event => { event.preventDefault(); if (nickname.trim()) setStep("photo"); }}><label className="name-field">내 이름<input value={nickname} onChange={event => setNickname(event.target.value)} placeholder="친구들이 알아볼 이름" autoComplete="nickname" maxLength={40} required /></label></form></> :
    <><h1>모두가 보정할<br />원본을 올려주세요</h1><p className="description">얼굴이 선명하게 나온 원본을 그대로 올려주세요.</p><PhotoPicker file={file} preview={preview} label="원본 사진 선택" onChange={pick} busy={busy} /><Notice>원본을 자르거나 필터를 적용하지 않은 상태로 올려주세요. 사진은 방 생성 후 24시간 동안 보관돼요.</Notice></>}
    <StatusMessage message={message} />
  </MobileShell>;
}
