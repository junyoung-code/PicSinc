import { runHeavyTask } from "@/core/heavy-task";
import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import { composePhoto } from "@/features/composition/compose";
import { randomUUID } from "node:crypto";
import type { AssetKind, CompositeResult, OverlapAssignment, Participant, PhotoAsset } from "@/core/contracts";
import { fail } from "./errors";
import { decodeMask } from "./image-validation";
import { createSecretToken, tokenHash } from "./tokens";
import type { CredentialRecord, NewAsset, PhotoSessionStore, PrivateFileStore, SessionRecord, SessionSnapshot } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export class PhotoSessionService {
  constructor(private readonly database: PhotoSessionStore, private readonly files: PrivateFileStore, private readonly now = () => new Date(), private readonly compose = composePhoto) {}

  async create(input: { nickname: string; original: { bytes: Buffer; width: number; height: number; contentType: string; extension: string } }) {
    const nickname = normalizeNickname(input.nickname);
    const id = randomUUID();
    const participantId = randomUUID();
    const inviteToken = createSecretToken();
    const sessionToken = createSecretToken();
    const recoveryToken = createSecretToken();
    const originalId = randomUUID();
    const createdAt = this.now();
    const original = asset(id, originalId, null, "original", input.original.width, input.original.height, input.original.contentType, input.original.extension);
    const session: SessionRecord = { id, ownerParticipantId: participantId, originalAssetId: originalId, version: 1, createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + DAY_MS).toISOString(), inviteToken };
    const participant: Participant = { id: participantId, sessionId: id, nickname, submitted: false };
    const credentials: CredentialRecord = { participantId, sessionId: id, sessionTokenHash: tokenHash(sessionToken), recoveryTokenHash: tokenHash(recoveryToken) };
    await this.files.put(original.storageKey, input.original.bytes, original.contentType);
    try { await this.database.createSession({ session, participant, credentials, original }); }
    catch (error) { await this.files.remove([original.storageKey]); throw error; }
    return { session, participant, sessionToken, recoveryToken };
  }

  async join(inviteToken: string, nickname: string) {
    const session = await this.requireActiveInvite(inviteToken);
    const participant: Participant = { id: randomUUID(), sessionId: session.id, nickname: normalizeNickname(nickname), submitted: false };
    const sessionToken = createSecretToken();
    const recoveryToken = createSecretToken();
    await this.database.createParticipant({ participant, credentials: { participantId: participant.id, sessionId: session.id, sessionTokenHash: tokenHash(sessionToken), recoveryTokenHash: tokenHash(recoveryToken) } });
    return { session, participant, sessionToken, recoveryToken };
  }

  async invitation(inviteToken: string) {
    const session = await this.requireActiveInvite(inviteToken);
    const snapshot = await this.database.snapshot(session.id);
    const owner = snapshot?.participants.find(participant => participant.id === session.ownerParticipantId);
    if (!owner) fail(404, "공유 작업을 찾을 수 없습니다.");
    return { ownerNickname: owner.nickname };
  }

  async recover(inviteToken: string, recoveryToken: string) {
    const session = await this.requireActiveInvite(inviteToken);
    const credentials = await this.database.findCredentialsByRecovery(session.id, tokenHash(recoveryToken));
    if (!credentials) fail(404, "복구 링크를 찾을 수 없습니다.");
    const sessionToken = createSecretToken();
    await this.database.replaceSessionToken(session.id, credentials.participantId, tokenHash(sessionToken));
    return { participantId: credentials.participantId, sessionToken };
  }

  async authorize(inviteToken: string, participantId: string, sessionToken: string): Promise<SessionRecord> {
    const session = await this.requireActiveInvite(inviteToken);
    const credentials = await this.database.findCredentials(session.id, participantId);
    if (!credentials || credentials.sessionTokenHash !== tokenHash(sessionToken)) fail(403, "이 작업을 수정할 권한이 없습니다.");
    return session;
  }

  async upload(input: { inviteToken: string; participantId: string; sessionToken: string; kind: Extract<AssetKind, "edited" | "mask">; bytes: Buffer; width: number; height: number; contentType: string; extension: string }) {
    const session = await this.authorize(input.inviteToken, input.participantId, input.sessionToken);
    const original = await this.requireOriginal(session);
    if (input.width !== original.width || input.height !== original.height) fail(400, "원본과 같은 크기의 파일이 필요합니다.");
    const record = asset(session.id, randomUUID(), input.participantId, input.kind, input.width, input.height, input.contentType, input.extension);
    await this.files.put(record.storageKey, input.bytes, record.contentType);
    try { return await this.database.createAsset(record); }
    catch (error) { await this.files.remove([record.storageKey]); throw error; }
  }

  async readOwnedEdit(input: { inviteToken: string; participantId: string; sessionToken: string; editedAssetId: string }) {
    const session = await this.authorize(input.inviteToken, input.participantId, input.sessionToken);
    const asset = await this.requireOwnedAsset(session.id, input.participantId, input.editedAssetId, "edited");
    return { asset, body: await this.files.get(asset.storageKey) };
  }

  async originalDetectionContext(input: { inviteToken: string; participantId: string; sessionToken: string }) {
    const session = await this.authorize(input.inviteToken, input.participantId, input.sessionToken);
    return { session, cached: await this.database.findOriginalDetection(session.id) };
  }

  async detectAsset(input: { inviteToken: string; participantId: string; sessionToken: string; assetId: string }, detect: (bytes: Buffer, size: { width: number; height: number }, requestId?: string) => Promise<DetectedRegions>, uploadedOriginal?: Buffer) {
    const requestId = randomUUID();
    const step = async <T>(name: string, action: () => Promise<T>, summary?: (result: T) => Record<string, number | boolean>): Promise<T> => {
      const started = performance.now();
      console.info("photo region detection", JSON.stringify({ requestId, step: name, status: "start" }));
      try {
        const result = await action();
        console.info("photo region detection", JSON.stringify({ requestId, step: name, status: "success", elapsedMs: Math.round(performance.now() - started), ...summary?.(result) }));
        return result;
      } catch (error) {
        console.error("photo region detection", JSON.stringify({ requestId, step: name, status: "failure", elapsedMs: Math.round(performance.now() - started), errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message.slice(0, 500) : undefined }));
        throw error;
      }
    };
    const session = await step("authorize", () => this.authorize(input.inviteToken, input.participantId, input.sessionToken));
    const original = input.assetId === session.originalAssetId;
    const photo = await step("asset-lookup", () => original ? this.requireOriginal(session) : this.requireOwnedAsset(session.id, input.participantId, input.assetId, "edited"));
    if (original) {
      const cached = await step("cache-lookup", () => this.database.findOriginalDetection(session.id), result => ({ cacheHit: Boolean(result) }));
      if (cached) return cached;
    }
    const bytes = original && uploadedOriginal ? uploadedOriginal : await step("photo-download", async () => Buffer.from(await (await this.files.get(photo.storageKey)).arrayBuffer()), result => ({ bytes: result.length }));
    const detected = await step("yolo-detection", () => detect(bytes, photo, requestId), result => ({ regions: result.regions.length, previewBase64Chars: result.previewPngBase64.length, maskBase64Chars: result.regions.reduce((total, region) => total + region.maskPngBase64.length, 0) }));
    await step("reauthorize", () => this.authorize(input.inviteToken, input.participantId, input.sessionToken));
    return original ? step("cache-save", () => this.database.cacheOriginalDetection(session.id, detected, requestId)) : detected;
  }

  async saveOriginalSelection(input: { inviteToken: string; participantId: string; sessionToken: string; maskAssetId: string; selectedRegionIds: string[]; expectedVersion: number }) {
    const session = await this.authorize(input.inviteToken, input.participantId, input.sessionToken);
    assertVersion(input.expectedVersion);
    if (!Array.isArray(input.selectedRegionIds) || input.selectedRegionIds.length > 200 || input.selectedRegionIds.some(id => typeof id !== "string" || id.length > 80)) fail(400, "선택 ID가 올바르지 않습니다.");
    if (input.selectedRegionIds.length) {
      const detection = await this.database.findOriginalDetection(session.id);
      if (!detection || input.selectedRegionIds.some(id => !detection.regions.some(region => region.id === id))) fail(400, "원본에서 검출된 ID를 선택해 주세요.");
    }
    if (!await this.hasSelectedPixels(session, input.participantId, input.maskAssetId)) fail(400, "자신의 영역을 먼저 선택해 주세요.");
    const version = await this.database.replaceOriginalSelection({ ...input, sessionId: session.id, selectedRegionIds: [...new Set(input.selectedRegionIds)] });
    if (version === null) fail(409, "다른 변경이 먼저 저장되었습니다. 다시 불러오세요.");
    return version;
  }

  async saveSelection(input: { inviteToken: string; participantId: string; sessionToken: string; editedAssetId: string; maskAssetId: string; expectedVersion: number }) {
    const session = await this.authorize(input.inviteToken, input.participantId, input.sessionToken);
    assertVersion(input.expectedVersion);
    await this.requireOwnedAsset(session.id, input.participantId, input.editedAssetId, "edited");
    const submitted = await this.hasSelectedPixels(session, input.participantId, input.maskAssetId);
    const snapshot = await this.database.snapshot(session.id);
    if (!snapshot?.originalSelections.some(selection => selection.participantId === input.participantId)) fail(400, "원본에서 자신의 영역을 먼저 저장해 주세요.");
    const version = await this.database.replaceSelection({ ...input, sessionId: session.id, submitted });
    if (version === null) fail(409, "다른 변경이 먼저 저장되었습니다. 다시 불러오세요.");
    return version;
  }

  async saveOverlapAssignments(input: { inviteToken: string; participantId: string; sessionToken: string; assignments: OverlapAssignment[]; expectedVersion: number }) {
    const session = await this.authorize(input.inviteToken, input.participantId, input.sessionToken);
    this.assertOwner(session, input.participantId);
    assertVersion(input.expectedVersion);
    for (const assignment of input.assignments) {
      await this.requireSessionAsset(session.id, assignment.editedAssetId, "edited");
      await this.requireSessionAsset(session.id, assignment.maskAssetId, "mask");
    }
    await this.assertNonOverlappingMasks(session, input.assignments);
    const version = await this.database.replaceOverlapAssignments({ sessionId: session.id, participantId: input.participantId, assignments: input.assignments, expectedVersion: input.expectedVersion });
    if (version === null) fail(409, "다른 변경이 먼저 저장되었습니다. 다시 불러오세요.");
    return version;
  }

  async snapshot(inviteToken: string, participantId: string, sessionToken: string): Promise<SessionSnapshot> {
    const session = await this.authorize(inviteToken, participantId, sessionToken);
    const snapshot = await this.database.snapshot(session.id);
    if (!snapshot) fail(404, "작업을 찾을 수 없습니다.");
    return snapshot;
  }

  async download(inviteToken: string, participantId: string, sessionToken: string, assetId: string): Promise<{ asset: PhotoAsset; body: Blob }> {
    const session = await this.authorize(inviteToken, participantId, sessionToken);
    const asset = await this.database.findAsset(session.id, assetId);
    if (!asset) fail(404, "파일을 찾을 수 없습니다.");
    return { asset, body: await this.files.get(asset.storageKey) };
  }

  async composeResult(input: { inviteToken: string; participantId: string; sessionToken: string; expectedVersion: number }): Promise<CompositeResult> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail(400, "작업 버전이 올바르지 않습니다.");
    const snapshot = await this.snapshot(input.inviteToken, input.participantId, input.sessionToken);
    const { session } = snapshot;
    this.assertOwner(session, input.participantId);
    const submittedIds = new Set(snapshot.participants.filter(participant => participant.submitted).map(participant => participant.id));
    if (!submittedIds.size) fail(400, "한 명 이상 영역과 보정본을 제출해야 병합할 수 있습니다.");
    if (session.version !== input.expectedVersion) fail(409, "다른 변경이 먼저 저장되었습니다. 새 내용을 불러와 주세요.");
    if (snapshot.result?.version === session.version) return snapshot.result;
    const selections = snapshot.selections.filter(selection => submittedIds.has(selection.participantId));
    const editedOwners = new Map(snapshot.assets.filter(asset => asset.kind === "edited").map(asset => [asset.id, asset.participantId]));
    const overlapAssignments = snapshot.overlapAssignments.filter(assignment => {
      const editedOwner = editedOwners.get(assignment.editedAssetId);
      return editedOwner !== null && editedOwner !== undefined && submittedIds.has(editedOwner);
    });
    const required = new Map<string, AssetKind>([[session.originalAssetId, "original"]]);
    for (const selection of selections) {
      await this.requireOwnedAsset(session.id, selection.participantId, selection.editedAssetId, "edited");
      await this.requireOwnedAsset(session.id, selection.participantId, selection.maskAssetId, "mask");
      required.set(selection.editedAssetId, "edited"); required.set(selection.maskAssetId, "mask");
    }
    for (const assignment of overlapAssignments) {
      required.set(assignment.editedAssetId, "edited"); required.set(assignment.maskAssetId, "mask");
    }
    const composed = await runHeavyTask(() => this.compose({ sessionId: session.id, version: session.version, originalAssetId: session.originalAssetId, selections, overlapAssignments }, async (id) => {
      const kind = required.get(id);
      if (!kind) fail(400, "합성에 사용할 수 없는 파일입니다.");
      const record = await this.requireSessionAsset(session.id, id, kind);
      return Buffer.from(await (await this.files.get(record.storageKey)).arrayBuffer());
    }));
    const preview = asset(session.id, randomUUID(), null, "preview", composed.previewWidth, composed.previewHeight, "image/png", "png");
    const result = asset(session.id, randomUUID(), null, "result", composed.width, composed.height, "image/png", "png");
    const output: CompositeResult = { sessionId: session.id, version: input.expectedVersion, previewAssetId: preview.id, resultAssetId: result.id, width: composed.width, height: composed.height, unassignedOverlapPixels: composed.unassignedOverlapPixels };
    try {
      await this.files.put(preview.storageKey, composed.previewPng, preview.contentType);
      await this.files.put(result.storageKey, composed.png, result.contentType);
      await this.authorize(input.inviteToken, input.participantId, input.sessionToken);
      if (!await this.database.publishComposition(output, [preview, result], input.participantId)) fail(409, "합성 중 작업이 바뀌었거나 다른 결과가 저장됐습니다. 새 내용을 불러와 다시 시도해 주세요.");
    } catch (error) {
      await this.files.remove([preview.storageKey, result.storageKey]);
      throw error;
    }
    return output;
  }

  async deleteExpired(): Promise<number> {
    const expired = await this.database.findExpired(this.now().toISOString());
    for (const snapshot of expired) {
      await this.files.remove(snapshot.assets.map((entry) => entry.storageKey));
      await this.database.deleteSession(snapshot.session.id);
    }
    return expired.length;
  }

  private assertOwner(session: SessionRecord, participantId: string) {
    if (session.ownerParticipantId !== participantId) fail(403, "대표자만 병합하거나 겹침을 수정할 수 있습니다.");
  }

  private async hasSelectedPixels(session: SessionRecord, participantId: string, maskAssetId: string) {
    const mask = await this.requireOwnedAsset(session.id, participantId, maskAssetId, "mask");
    const original = await this.requireOriginal(session);
    const decoded = await decodeMask(Buffer.from(await (await this.files.get(mask.storageKey)).arrayBuffer()));
    if (decoded.width !== original.width || decoded.height !== original.height) fail(400, "선택 영역 크기가 원본과 다릅니다.");
    return decoded.selected.some(value => value !== 0);
  }

  private async requireActiveInvite(inviteToken: string) {
    const session = await this.database.findSessionByInvite(inviteToken);
    if (!session) fail(404, "공유 작업을 찾을 수 없습니다.");
    if (new Date(session.expiresAt).getTime() <= this.now().getTime()) fail(410, "이 작업의 보관 기간이 끝났습니다.");
    return session;
  }

  private async requireOriginal(session: SessionRecord) { return this.requireSessionAsset(session.id, session.originalAssetId, "original"); }
  private async requireSessionAsset(sessionId: string, assetId: string, kind: AssetKind) {
    const asset = await this.database.findAsset(sessionId, assetId);
    if (!asset || asset.kind !== kind) fail(400, "이 작업의 올바른 파일이 아닙니다.");
    return asset;
  }
  private async requireOwnedAsset(sessionId: string, participantId: string, assetId: string, kind: AssetKind) {
    const asset = await this.requireSessionAsset(sessionId, assetId, kind);
    if (asset.participantId !== participantId) fail(403, "다른 참여자의 파일은 사용할 수 없습니다.");
    return asset;
  }
  private async assertNonOverlappingMasks(session: SessionRecord, assignments: OverlapAssignment[]) {
    const original = await this.requireOriginal(session); const used = new Uint8Array(original.width * original.height);
    for (const assignment of assignments) { const mask = await this.requireSessionAsset(session.id, assignment.maskAssetId, "mask"); const decoded = await decodeMask(Buffer.from(await (await this.files.get(mask.storageKey)).arrayBuffer())); if (decoded.width !== original.width || decoded.height !== original.height) fail(400, "선택 영역 크기가 원본과 다릅니다."); for (let index = 0; index < used.length; index++) { if (decoded.selected[index] && used[index]) fail(400, "겹침 지정 영역끼리는 겹칠 수 없습니다."); used[index] ||= decoded.selected[index]; } }
  }
}

function normalizeNickname(value: string) {
  const nickname = value.trim();
  if (nickname.length < 1 || nickname.length > 40) fail(400, "닉네임은 1~40자로 입력하세요.");
  return nickname;
}

function asset(sessionId: string, id: string, participantId: string | null, kind: AssetKind, width: number, height: number, contentType: string, extension: string): NewAsset {
  return { id, sessionId, participantId, kind, storageKey: `${sessionId}/${id}.${extension}`, width, height, contentType, extension };
}

function assertVersion(version: number) { if (!Number.isSafeInteger(version) || version < 1) fail(400, "작업 버전이 올바르지 않습니다."); }
