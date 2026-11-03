/** Shared JSON contract for collaborative rooms. No server imports. */
export type CollaborationPhase = 'lobby' | 'personal' | 'composing' | 'global' | 'review' | 'final';
export interface CollaborationHistory { version: number; participantId: string; assetId: string; createdAt: string }
export interface CollaborationView {
  enabled: boolean;
  phase: CollaborationPhase;
  rosterIds: string[];
  completedIds: string[];
  personalToken: string | null;
  personalMaskAssetId: string | null;
  personalState: unknown;
  editorId: string | null;
  leaseUntil: string | null;
  editToken: string | null;
  version: number;
  latestAssetId: string | null;
  history: CollaborationHistory[];
  job?: { id: string; status: 'queued' | 'running' | 'ready' | 'failed' };
}
export type CollaborationAction =
  | { action: 'enable' | 'start' | 'personal-begin' | 'compose' | 'acquire' | 'end-global' | 'finalize' }
  | { action: 'personal-cancel' | 'heartbeat' | 'cancel'; token: string }
  | { action: 'open-global'; resultAssetId: string }
  | { action: 'personal-save'; token: string; editedAssetId: string; state: unknown }
  | { action: 'save'; token: string; baseVersion: number; editedAssetId: string; state: unknown };
