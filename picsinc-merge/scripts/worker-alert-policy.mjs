export const POLL_MS = 30_000;
export const BACKLOG_MS = 120_000;
export const OUTAGE_MS = 120_000;

export function initialAlertState() {
  return {
    seen: false,
    busySince: null,
    backlogAlerted: false,
    unavailableSince: null,
    outageAlerted: false,
    lastFailed: 0,
  };
}

export function statusLine(value) {
  const workers = value.workers;
  const workerLine = workers ? ` · Windows ${workers.windows?.online ? '온라인' : '오프라인'} · Mac ${workers.mac?.online ? '온라인' : '오프라인'}` : '';
  return `대기 ${value.queued}건 · 처리 중 ${value.running}건 · 최장 대기 ${value.oldestQueuedSeconds ?? 0}초 · 최근 1시간 실패 ${value.failedLastHour}건${workerLine}`;
}

export function evaluateStatus(state, value, now) {
  const next = { ...state, unavailableSince: null, outageAlerted: false };
  const messages = [];
  const line = statusLine(value);

  if (!state.seen) {
    next.seen = true;
  } else if (state.outageAlerted) {
    messages.push(`PicSync 상태 조회 복구\n${line}`);
  }

  const busy = value.queued >= 3 || (value.oldestQueuedSeconds ?? 0) > 60;
  next.busySince = busy ? (state.busySince ?? now) : null;
  if (busy && !state.backlogAlerted && now - next.busySince >= BACKLOG_MS) {
    messages.push(`PicSync 대기 증가 — Mac 보조 워커 실행을 검토하세요.\n${line}`);
    next.backlogAlerted = true;
  } else if (!busy && state.backlogAlerted) {
    messages.push(`PicSync 대기 정상화\n${line}`);
    next.backlogAlerted = false;
  }

  if (state.seen && value.failedLastHour > state.lastFailed) {
    messages.push(`PicSync 최근 실패 건수 증가\n${line}`);
  }
  next.lastFailed = value.failedLastHour;

  return { state: next, messages };
}

export function evaluateUnavailable(state, now) {
  const next = { ...state, unavailableSince: state.unavailableSince ?? now, busySince: null };
  const messages = [];
  if (!state.outageAlerted && now - next.unavailableSince >= OUTAGE_MS) {
    messages.push('PicSync 서버 상태 조회가 2분 이상 실패했습니다. 서버와 네트워크를 확인하세요.');
    next.outageAlerted = true;
  }
  return { state: next, messages };
}

export function commandFromUpdate(update, allowedChatId) {
  const message = update?.message;
  if (message?.chat?.type !== 'private' || String(message.chat.id) !== String(allowedChatId)) return null;
  const command = message.text?.trim().split(/\s+/)[0]?.split('@')[0];
  return command === '/status' || command === '/start' ? command : null;
}
