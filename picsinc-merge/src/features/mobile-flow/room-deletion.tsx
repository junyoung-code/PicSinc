"use client";

import { useEffect, useRef, useState } from "react";
import MobileShell from "@/components/mobile-shell";
import { request, RequestError } from "./client";

export function DeletedRoomScreen() {
  return <MobileShell title="PicSync" showProgress={false}>
    <section className="deleted-room" aria-labelledby="deleted-room-title">
      <img src="/images/figma/room-deleted.svg" width="72" height="72" alt="" />
      <h1 id="deleted-room-title">보정방이 삭제되었어요</h1>
      <p>대표자가 보정방을 삭제해<br />현재 작업을 계속할 수 없어요.</p>
      <div className="deleted-room-notice"><strong>다시 참여하려면</strong><p>대표자에게 새 초대 링크를 받아주세요.<br />기존 링크와 작업 내용은 사용할 수 없어요.</p></div>
    </section>
  </MobileShell>;
}

export function DeleteRoomDialog({ base, onCancel, onDeleted }: { base: string; onCancel: () => void; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; dialog.current?.close(); previousFocus?.focus(); };
  }, []);
  async function remove() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await request(base, { method: "DELETE" }); onDeleted(); }
    catch (reason) {
      // A lost successful response or another owner tab can already have deleted it.
      if (reason instanceof RequestError && reason.code === "SESSION_DELETED") { onDeleted(); return; }
      setError("방을 삭제하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
      pending.current = false; setBusy(false);
    }
  }
  return <dialog ref={dialog} className="delete-room-dialog" aria-labelledby="delete-room-title" aria-describedby="delete-room-description" onCancel={event => { event.preventDefault(); if (!pending.current) onCancel(); }}>
    <div className="delete-room-icon" aria-hidden="true">!</div>
    <h2 id="delete-room-title">방을 삭제하고<br />처음부터 시작할까요?</h2>
    <p id="delete-room-description">참여자 전원의 작업과 업로드한 사진이 모두 사라지고,<br />기존 초대 링크도 더 이상 사용할 수 없어요.</p>
    <strong className="delete-room-warning">삭제한 방은 복구할 수 없어요.</strong>
    {error && <p className="delete-room-error" role="alert">{error}</p>}
    <div className="delete-room-buttons"><button disabled={busy} onClick={onCancel}>취소</button><button disabled={busy} onClick={() => void remove()}>{busy ? "삭제 중…" : "삭제하고 다시 시작"}</button></div>
  </dialog>;
}
