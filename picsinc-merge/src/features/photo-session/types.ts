import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import type { AssetKind, CompositeResult, OriginalSelection, OverlapAssignment, Participant, PhotoAsset, PhotoSession, Selection } from "@/core/contracts";

export interface CredentialRecord {
  participantId: string;
  sessionId: string;
  sessionTokenHash: string;
  recoveryTokenHash: string;
}

export interface SessionRecord extends PhotoSession {
  inviteToken: string;
}

export interface RegionClaim {
  regionId: string;
  participantId: string;
  nickname: string;
}

export interface SessionSnapshot {
  session: SessionRecord;
  participants: Participant[];
  assets: PhotoAsset[];
  selections: Selection[];
  originalSelections: OriginalSelection[];
  overlapAssignments: OverlapAssignment[];
  result?: CompositeResult | null;
}

export interface NewAsset {
  id: string;
  sessionId: string;
  participantId: string | null;
  kind: AssetKind;
  storageKey: string;
  width: number;
  height: number;
  contentType: string;
  extension: string;
}

export interface PhotoSessionStore {
  createSession(input: { session: SessionRecord; participant: Participant; credentials: CredentialRecord; original: NewAsset }): Promise<void>;
  findSessionByInvite(inviteToken: string): Promise<SessionRecord | null>;
  findCredentials(sessionId: string, participantId: string): Promise<CredentialRecord | null>;
  findCredentialsByRecovery(sessionId: string, recoveryTokenHash: string): Promise<CredentialRecord | null>;
  replaceSessionToken(sessionId: string, participantId: string, sessionTokenHash: string): Promise<void>;
  createParticipant(input: { participant: Participant; credentials: CredentialRecord }): Promise<void>;
  snapshot(sessionId: string): Promise<SessionSnapshot | null>;
  publishComposition(result: CompositeResult, assets: NewAsset[], participantId: string): Promise<boolean>;
  createAsset(asset: NewAsset): Promise<PhotoAsset>;
  findAsset(sessionId: string, assetId: string): Promise<PhotoAsset | null>;
  replaceSelection(input: { sessionId: string; participantId: string; editedAssetId: string; maskAssetId: string; expectedVersion: number; submitted: boolean }): Promise<number | null>;
  replaceOverlapAssignments(input: { sessionId: string; participantId: string; assignments: OverlapAssignment[]; expectedVersion: number }): Promise<number | null>;
  replaceOriginalSelection(input: { sessionId: string; participantId: string; maskAssetId: string; selectedRegionIds: string[]; expectedVersion: number }): Promise<number | null>;
  listRegionClaims(sessionId: string): Promise<RegionClaim[]>;
  setRegionClaim(input: { sessionId: string; participantId: string; regionId: string; selected: boolean }): Promise<{ claims: RegionClaim[]; conflict?: RegionClaim }>;
  findOriginalDetection(sessionId: string): Promise<DetectedRegions | null>;
  cacheOriginalDetection(sessionId: string, detection: DetectedRegions, requestId?: string): Promise<DetectedRegions>;
  findExpired(now: string): Promise<SessionSnapshot[]>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface PrivateFileStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Blob>;
  remove(keys: string[]): Promise<void>;
}
