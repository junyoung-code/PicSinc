export type OriginalIntent = {
  id: string; session_id: string; nickname: string | null; status: string;
  created_at: string; byte_size: number;
};
export type RoomRow = { id: string; created_at: string };
export type JobRow = {
  id: string; session_id: string; kind: string; status: string;
  created_at: string; updated_at: string; attempts: number;
};
export type JobObservation = { runningAt?: number };
export type RunConfig = { startedAt: string; targetTeams: number; prefix: string };
export type BrowserUpload = { uploadId: string; prepareMs: number; storageMs: number; completeMs: number; totalMs: number; status: "ready" | "failed" };

const millis = (value: string) => Date.parse(value);
const duration = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
const percentile = (values: number[], portion: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * portion) - 1];
};

export function summarizeRun(run: RunConfig, intents: OriginalIntent[], rooms: RoomRow[], jobs: JobRow[],
  observed: Map<string, JobObservation>, peakQueued: number, now = Date.now(), browserUploads = new Map<string, BrowserUpload>()) {
  const roomById = new Map(rooms.map(room => [room.id, room]));
  const jobByRoom = new Map(jobs.filter(job => job.kind === "detect").map(job => [job.session_id, job]));
  const matching = intents.filter(intent => intent.nickname?.toLowerCase().startsWith(run.prefix.toLowerCase()))
    .sort((a, b) => millis(a.created_at) - millis(b.created_at));
  const teams = matching.map((intent, index) => {
    const room = roomById.get(intent.session_id);
    const job = jobByRoom.get(intent.session_id);
    const browser = browserUploads.get(intent.id);
    const started = job && observed.get(job.id)?.runningAt;
    const finished = job && ["ready", "failed"].includes(job.status) ? millis(job.updated_at) : null;
    const submitted = job ? millis(job.created_at) : null;
    return {
      number: index + 1,
      uploadStatus: room ? "ready" : intent.status,
      uploadMs: room ? duration(millis(intent.created_at), millis(room.created_at)) : null,
      browser: browser ? { prepareMs: browser.prepareMs, storageMs: browser.storageMs,
        completeMs: browser.completeMs, totalMs: browser.totalMs, status: browser.status } : null,
      originalBytes: intent.byte_size,
      jobStatus: job?.status ?? (room ? "not_queued" : "waiting_upload"),
      queueMs: job && started ? duration(submitted!, started) : null,
      processingMs: job && started && finished ? duration(started, finished) : null,
      totalJobMs: job && finished ? duration(submitted!, finished) : null,
      elapsedMs: job && !finished ? duration(submitted!, now) : null,
      attempts: job?.attempts ?? 0,
    };
  });
  const completed = teams.filter(team => team.jobStatus === "ready");
  const uploadTimes = teams.map(team => team.uploadMs).filter((value): value is number => value !== null);
  const storageTimes = teams.map(team => team.browser?.storageMs).filter((value): value is number => value !== undefined && value !== null);
  const verificationTimes = teams.map(team => team.browser?.completeMs).filter((value): value is number => value !== undefined && value !== null);
  const queueTimes = completed.map(team => team.queueMs).filter((value): value is number => value !== null);
  const processingTimes = completed.map(team => team.processingMs).filter((value): value is number => value !== null);
  const phases = [
    { name: "Storage 전송", value: percentile(storageTimes, .5) },
    { name: "서버 완료 확인", value: percentile(verificationTimes, .5) },
    { name: "원본 접수", value: storageTimes.length ? null : percentile(uploadTimes, .5) },
    { name: "YOLO 대기", value: percentile(queueTimes, .5) },
    { name: "YOLO 처리·전송", value: percentile(processingTimes, .5) },
  ].filter((phase): phase is { name: string; value: number } => phase.value !== null);
  const bottleneck = phases.length >= 2 ? phases.sort((a, b) => b.value - a.value)[0].name : "측정 중";
  return {
    startedAt: run.startedAt, generatedAt: new Date(now).toISOString(), targetTeams: run.targetTeams,
    observedTeams: teams.length, uploadedTeams: teams.filter(team => team.uploadStatus === "ready").length,
    queuedJobs: teams.filter(team => team.jobStatus === "queued").length,
    runningJobs: teams.filter(team => team.jobStatus === "running").length,
    completedJobs: completed.length, failedJobs: teams.filter(team => team.jobStatus === "failed").length,
    peakQueued, totalOriginalBytes: teams.filter(team => team.uploadStatus === "ready").reduce((sum, team) => sum + team.originalBytes, 0),
    p95UploadMs: percentile(uploadTimes, .95),
    p95StorageMs: percentile(storageTimes, .95),
    p95VerificationMs: percentile(verificationTimes, .95),
    p95QueueMs: percentile(queueTimes, .95),
    p95JobMs: percentile(completed.map(team => team.totalJobMs).filter((value): value is number => value !== null), .95),
    bottleneck, teams,
    notes: {
      sampling: "YOLO 시작 시각은 2초 간격 관찰값으로 오차가 있다. 완료 시각은 DB updated_at이다.",
      upload: "원본 접수 시간은 업로드 준비부터 방 생성까지이며 Storage 전송과 서버 검증을 합친 값이다.",
      costs: "원본 바이트는 업로드량이다. 실제 저장량·전송량·요금은 제공업체 Usage와 따로 대조해야 한다.",
    },
  };
}
