import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import type { OriginalDetectionState } from "@/features/photo-session/original-detection-state";

interface Options {
  read: () => Promise<OriginalDetectionState>;
  start: () => Promise<OriginalDetectionState>;
  result: () => Promise<DetectedRegions>;
  canApply: () => boolean;
  onState: (state: OriginalDetectionState) => void;
  onResult: (result: DetectedRegions) => void;
  onError: (error: unknown) => void;
}

import { pollingDelay } from "./polling";

/** A screen's subscription only; disposing never cancels the server job. */
export function originalDetectionMonitor(options: Options) {
  let active = true, pending = false, applied = false;
  let failures = 0, nextAt = 0;
  let state: OriginalDetectionState = { status: "idle" };
  async function check(retry = false) {
    if (!active || pending || (!retry && Date.now() < nextAt)) return;
    pending = true;
    try {
      let next = retry ? await options.start() : await options.read();
      if (!active) return;
      if (next.status === "idle") next = await options.start();
      if (!active) return;
      failures = 0; nextAt = 0;
      state = next; options.onState(next);
      if (next.status === "ready" && !applied && options.canApply()) {
        const result = await options.result();
        if (active && options.canApply()) { applied = true; options.onResult(result); }
      }
    } catch (error) {
      if (active) {
        if (state.status === "queued" || state.status === "running") {
          failures++;
          nextAt = Date.now() + pollingDelay(3000, failures);
          options.onError(error);
          return;
        }
        state = { status: "failed", error: error instanceof Error ? error.message : "분석 상태를 확인하지 못했어요. 다시 시도해 주세요." };
        options.onState(state); options.onError(error);
      }
    } finally { pending = false; }
  }
  return { check, polling: () => state.status === "queued" || state.status === "running", dispose: () => { active = false; } };
}
