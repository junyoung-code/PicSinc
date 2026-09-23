import type { CompositionInput } from "./contracts";

export type JobStatus = "queued" | "running" | "ready" | "failed";
export interface JobView { id: string; status: JobStatus; error?: string; code?: string; resultUrl?: string }
export interface SignedUpload { signedUrl: string; token: string; path: string }
export interface WorkerAssignment {
  id: string;
  leaseToken: string;
  kind: "detect" | "compose";
  input: { assetId: string; width: number; height: number } | CompositionInput;
  files: Record<string, string>;
  outputs: Record<string, SignedUpload>;
}
export type WorkerCompletion = {
  id: string;
  leaseToken: string;
  result: { width: number; height: number; regions?: { id: string; box: { x: number; y: number; width: number; height: number } }[]; previewWidth?: number; previewHeight?: number; unassignedOverlapPixels?: number };
};
