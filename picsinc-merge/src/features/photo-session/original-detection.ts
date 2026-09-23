import { detectRegionsUnderLock } from "@/features/region-editor/detect-regions";
import { SessionError } from "./errors";
import { originalDetectionJobs, type ScheduleAfterResponse } from "./original-detection-jobs";
import type { OriginalDetectionState } from "./original-detection-state";
import type { PhotoSessionService } from "./service";
import type { SessionRecord } from "./types";

type Auth = { inviteToken: string; participantId: string; sessionToken: string };

/** Only call with the session and bytes returned by the successful upload transaction. */
export function scheduleUploadedOriginal(service: PhotoSessionService, session: SessionRecord, auth: Auth, bytes: Buffer, schedule: ScheduleAfterResponse) {
  return originalDetectionJobs.start(session.id, session.expiresAt, schedule, () => service.detectAsset(
    { ...auth, assetId: session.originalAssetId }, detectRegionsUnderLock, bytes,
  ));
}

export async function originalDetectionState(service: PhotoSessionService, auth: Auth): Promise<OriginalDetectionState> {
  const { session, cached } = await service.originalDetectionContext(auth);
  return cached ? { status: "ready" } : originalDetectionJobs.state(session.id);
}

export async function startOriginalDetection(service: PhotoSessionService, auth: Auth, schedule: ScheduleAfterResponse, uploadedOriginal?: Buffer) {
  const { session, cached } = await service.originalDetectionContext(auth);
  if (cached) return { state: { status: "ready" } as OriginalDetectionState, cached };
  const job = originalDetectionJobs.start(session.id, session.expiresAt, schedule, () => service.detectAsset(
    { ...auth, assetId: session.originalAssetId }, detectRegionsUnderLock, uploadedOriginal,
  ));
  return { state: job.state, done: job.done };
}

/** Compatibility for existing synchronous original /regions callers. */
export async function waitForOriginalDetection(service: PhotoSessionService, auth: Auth) {
  const started = await startOriginalDetection(service, auth, work => { void work(); });
  if (started.cached) return started.cached;
  if (!started.done) throw new SessionError(started.state.code === "busy" ? 429 : 503, started.state.error ?? "분석을 다시 시도해 주세요.");
  const outcome = await started.done;
  await service.authorize(auth.inviteToken, auth.participantId, auth.sessionToken);
  if (outcome.error) throw outcome.error;
  return outcome.result;
}
