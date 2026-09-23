// Product contracts are defined in MASTER_SPEC.md. IDs are opaque strings.
export type AssetKind = "original" | "edited" | "mask" | "preview" | "result";

export interface PhotoAsset {
  id: string;
  sessionId: string;
  participantId: string | null;
  kind: AssetKind;
  storageKey: string; // Server-only: expose authorized download URLs separately.
  width: number;
  height: number;
  contentType: string;
  uploadOrder: number | null; // Server-assigned successful registration order for edited photos only.
}

export interface PhotoSession {
  id: string;
  ownerParticipantId: string;
  originalAssetId: string;
  version: number;
  createdAt: string;
  expiresAt: string;
}

export interface Participant {
  id: string;
  sessionId: string;
  nickname: string;
  submitted: boolean;
}

export interface OriginalSelection {
  participantId: string;
  maskAssetId: string;
  selectedRegionIds: string[];
}

// Never include these hashes in client responses.
export interface ParticipantCredentials {
  participantId: string;
  sessionId: string;
  sessionTokenHash: string;
  recoveryTokenHash: string;
}

export interface Selection {
  participantId: string;
  editedAssetId: string;
  maskAssetId: string;
}

export interface OverlapAssignment {
  editedAssetId: string;
  maskAssetId: string;
}

export interface CompositionInput {
  sessionId: string;
  version: number;
  originalAssetId: string;
  selections: Selection[];
  overlapAssignments: OverlapAssignment[];
}

export interface CompositeResult {
  sessionId: string;
  version: number;
  previewAssetId: string;
  resultAssetId: string;
  width: number;
  height: number;
  unassignedOverlapPixels: number;
}
