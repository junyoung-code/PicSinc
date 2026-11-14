"use client";
import { useState } from "react";
import { Notice, PhotoPicker, StatusMessage } from "@/components/mobile-shell";
import MobileShell, { MergeIntro as ServiceIntro, MergeWelcome, MergeSteps } from "@/features/merge-flow/MergeShell";
import { photoError, rememberRecovery, usePreview } from "@/features/mobile-flow/client";
import { uploadOriginal } from "@/core/remote-client";
import { NICKNAME_MAX_LENGTH } from "@/core/nickname";

export default function NewSessionPage() {
  const [step, setStep] = useState<"intro" | "name" | "photo">("intro");
  const [nickname, setNickname] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [consented, setConsented] = useState(false);
  const [message, setMessage] = useState("");
  const preview = usePreview(file);
  function pick(next: File | null) { const error = next ? photoError(next) : ""; setMessage(error); setFile(error ? null : next); setConsented(false); }
  async function create() {
    if (!file || !consented || busy || !nickname.trim()) return;
    setBusy(true); setMessage("");
    try {
      const body = await uploadOriginal(nickname.trim(), file);
      rememberRecovery(body.session.inviteToken, body.recoveryUrl);
      location.assign(`${body.shareUrl}?step=invite`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "보정방을 만들지 못했어요."); setBusy(false); }
  }
  if (step === "intro") return <ServiceIntro onStart={() => setStep("name")} />;
  return <MobileShell helpTopic={step === "name" ? "start" : "original"} title={step === "name" ? "시작하기" : "원본 사진 올리기"} progress={16} onBack={!busy ? () => setStep(step === "photo" ? "name" : "intro") : undefined} footer={step === "name" ?
    <button className="primary-button" disabled={!nickname.trim()} onClick={() => { setStep("photo"); setMessage(""); }}>원본 사진 올리기</button> :
    <button className="primary-button" disabled={!file || !consented || busy} onClick={() => void create()}>{busy ? "보정방을 만들고 있어요…" : "이 사진으로 보정방 만들기"}</button>}>
    {step === "name" ? <><MergeWelcome /><form onSubmit={event => { event.preventDefault(); if (nickname.trim()) setStep("photo"); }}><label className="name-field host-name-field">대표자 이름<input value={nickname} onChange={event => setNickname(event.target.value)} placeholder="친구들이 알아볼 이름" autoComplete="nickname" maxLength={NICKNAME_MAX_LENGTH} required /></label></form><MergeSteps /></> :
    <><h1>모두가 보정할<br />원본을 올려주세요</h1><p className="description">얼굴이 선명하게 나온 원본을 그대로 올려주세요.</p><PhotoPicker file={file} preview={preview} label="원본 사진 선택" onChange={pick} busy={busy} />{file && <><Notice>원본을 자르거나 필터를 적용하지 않은 상태로 올려주세요.<br />사진은 방 생성 후 24시간 동안 보관돼요.</Notice><label className="photo-consent"><input type="checkbox" checked={consented} onChange={event => setConsented(event.target.checked)} />이 사진을 방 참여자와 공유하고, MOIRA의 얼굴 영역 분석·합성에 사용하는 데 동의해요.</label></>}</>}
    <StatusMessage message={message} />
  </MobileShell>;
}
