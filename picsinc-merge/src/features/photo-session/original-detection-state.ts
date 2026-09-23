export type OriginalDetectionStatus = "idle" | "queued" | "running" | "ready" | "failed";
export interface OriginalDetectionState {
  status: OriginalDetectionStatus;
  error?: string;
  code?: "busy" | "failed";
}
