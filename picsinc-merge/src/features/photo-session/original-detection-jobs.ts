import { randomUUID } from "node:crypto";
import { heavyTaskGate, type HeavyTaskGate } from "@/core/heavy-task";
import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import { SessionError } from "./errors";
import type { OriginalDetectionState } from "./original-detection-state";

export type ScheduleAfterResponse = (work: () => Promise<void>) => void;
type Outcome = { result: DetectedRegions; error?: never } | { result?: never; error: unknown };
interface Job {
  state: OriginalDetectionState;
  expiresAt: number;
  done?: Promise<Outcome>;
  cleanup: ReturnType<typeof setTimeout>;
}

/** Ephemeral execution state. Persisted detection cache is the source of truth for ready. */
export class OriginalDetectionJobs {
  private jobs = new Map<string, Job>();
  constructor(private readonly gate: HeavyTaskGate = heavyTaskGate, private readonly now = Date.now) {}

  state(sessionId: string): OriginalDetectionState {
    const job = this.jobs.get(sessionId);
    if (job && job.expiresAt <= this.now()) this.remove(sessionId, job);
    return this.jobs.get(sessionId)?.state ?? { status: "idle" };
  }

  start(sessionId: string, expiresAt: string, schedule: ScheduleAfterResponse, work: () => Promise<DetectedRegions>) {
    this.state(sessionId);
    const existing = this.jobs.get(sessionId);
    if (existing?.done) return existing;
    if (existing) this.remove(sessionId, existing);
    const queuedAt = this.now();
    const requestId = randomUUID();
    const job: Job = {
      state: { status: "queued" }, expiresAt: Date.parse(expiresAt),
      cleanup: setTimeout(() => this.remove(sessionId, job), Math.max(1, Date.parse(expiresAt) - this.now())),
    };
    job.cleanup.unref();
    // Bound buffers retained before Next has invoked the after callbacks as well.
    if ([...this.jobs.values()].filter(entry => entry.state.status === "queued").length >= 8) {
      job.state = { status: "failed", code: "busy", error: "분석 대기가 많아요. 잠시 후 다시 시도해 주세요." };
      this.jobs.set(sessionId, job);
      return job;
    }
    let finish!: (outcome: Outcome) => void;
    job.done = new Promise(resolve => { finish = resolve; });
    this.jobs.set(sessionId, job);
    let task: (() => Promise<DetectedRegions>) | undefined = work;
    const fail = (error: unknown) => {
      job.state = { status: "failed", code: error instanceof SessionError && error.status === 429 ? "busy" : "failed", error: error instanceof SessionError ? error.message : "사람 영역을 찾지 못했어요. 다시 시도하거나 직접 선택해 주세요." };
      console.error("original detection job", JSON.stringify({ requestId, status: "failed", code: job.state.code }));
      finish({ error });
    };
    try {
      schedule(async () => {
        if (!task) return;
        try {
          const result = await this.gate.enqueue(async () => {
            if (job.expiresAt <= this.now()) throw new SessionError(410, "이 작업의 보관 기간이 끝났습니다.");
            job.state = { status: "running" };
            console.info("original detection job", JSON.stringify({ requestId, status: "running", queueMs: this.now() - queuedAt }));
            return task!();
          });
          job.state = { status: "ready" };
          console.info("original detection job", JSON.stringify({ requestId, status: "ready", totalMs: this.now() - queuedAt }));
          finish({ result });
          this.remove(sessionId, job);
        } catch (error) { fail(error); }
        finally { task = undefined; job.done = undefined; }
      });
    } catch (error) { task = undefined; fail(error); job.done = undefined; }
    return job;
  }

  private remove(sessionId: string, job: Job) {
    if (this.jobs.get(sessionId) === job) this.jobs.delete(sessionId);
    clearTimeout(job.cleanup);
  }
}

const processState = globalThis as typeof globalThis & { picsyncOriginalDetectionJobs?: OriginalDetectionJobs };
export const originalDetectionJobs = processState.picsyncOriginalDetectionJobs ??= new OriginalDetectionJobs();
