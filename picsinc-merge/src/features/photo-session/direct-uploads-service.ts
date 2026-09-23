import { createHmac, randomUUID } from "node:crypto";
import type { PhotoAsset } from "@/core/contracts";
import { fail } from "./errors";
import { MAX_PHOTO_BYTES, verifyMask, verifyPhotoBytes } from "./image-validation";
import type { VerifiedImage } from "./image-validation";
import { createSecretToken, tokenHash } from "./tokens";
import type { PhotoSessionStore } from "./types";
import type { PhotoSessionService } from "./service";

export type UploadKind = "original" | "edited" | "mask";
export type UploadAuth = { inviteToken: string; participantId: string; sessionToken: string };
export type UploadMetadata = { contentType: string; size: number };
export type UploadIntent = {
  id: string; kind: UploadKind; session_id: string; participant_id: string; asset_id: string;
  invite_token: string; nickname: string | null; owner_hash: string;
  session_token_hash: string | null; recovery_token_hash: string | null;
  content_type: string; byte_size: number; temporary_key: string; final_key: string;
  expires_at: string; status: "uploading" | "verifying" | "ready";
  lease_token: string | null; lease_expires_at: string | null;
};
export interface DirectUploadRepository {
  insert(intent: UploadIntent): Promise<void>;
  find(id: string): Promise<UploadIntent | null>;
  claim(id: string, ownerHash: string, leaseToken: string): Promise<UploadIntent>;
  release(id: string, leaseToken: string): Promise<void>;
  finalize(intent: UploadIntent, ownerHash: string, leaseToken: string, image: VerifiedImage): Promise<void>;
}
export interface DirectUploadFiles {
  signUpload(path: string): Promise<{ signedUrl: string; token: string; path: string }>;
  read(path: string): Promise<Buffer>;
  putImmutable(path: string, bytes: Buffer, contentType: string): Promise<void>;
}

export function originalUploadSecrets(id: string, secret: string) {
  if (secret.length < 32) throw new Error("UPLOAD_SIGNING_SECRET must contain at least 32 characters");
  const derive = (purpose: string) => createHmac("sha256", secret).update(`upload:${id}:${purpose}`).digest("base64url");
  return { sessionToken: derive("session"), recoveryToken: derive("recovery") };
}

export function validateUploadMetadata(input: UploadMetadata, kind: UploadKind) {
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_PHOTO_BYTES) fail(400, "파일은 20MB 이하여야 합니다.");
  if (!["image/jpeg", "image/png"].includes(input.contentType) || (kind === "mask" && input.contentType !== "image/png")) fail(400, "사진은 JPEG·PNG, 선택 영역은 PNG여야 합니다.");
}

// Do not trust Content-Length: chunked responses must obey the same memory limit.
export async function readBoundedUpload(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) fail(400, "업로드한 파일을 찾을 수 없습니다. 다시 올려 주세요.");
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_PHOTO_BYTES) { await response.body.cancel(); fail(400, "파일은 20MB 이하여야 합니다."); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) { await reader.cancel(); fail(400, "파일은 20MB 이하여야 합니다."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) fail(400, "빈 파일은 올릴 수 없습니다.");
  return Buffer.concat(chunks, size);
}

export class DirectUploadService {
  constructor(
    private readonly intents: DirectUploadRepository,
    private readonly files: DirectUploadFiles,
    private readonly sessions: Pick<PhotoSessionService, "authorize">,
    private readonly database: Pick<PhotoSessionStore, "findAsset" | "findSessionByInvite" | "findCredentials">,
    private readonly secret: string,
    private readonly now = () => new Date(),
  ) {}

  async prepareOriginalUpload(nickname: string, metadata: UploadMetadata, bootstrapToken: string) {
    validateUploadMetadata(metadata, "original");
    nickname = nickname.trim();
    if (!nickname || nickname.length > 40) fail(400, "닉네임은 1~40자로 입력하세요.");
    if (!bootstrapToken) fail(403, "업로드 참여증이 필요합니다.");
    const id = randomUUID(); const secrets = originalUploadSecrets(id, this.secret);
    return this.prepare({ id, kind: "original", session_id: randomUUID(), participant_id: randomUUID(), asset_id: randomUUID(), invite_token: createSecretToken(), nickname, owner_hash: tokenHash(bootstrapToken), session_token_hash: tokenHash(secrets.sessionToken), recovery_token_hash: tokenHash(secrets.recoveryToken) }, metadata);
  }

  async prepareSessionUpload(auth: UploadAuth, kind: "edited" | "mask", metadata: UploadMetadata) {
    validateUploadMetadata(metadata, kind);
    const session = await this.sessions.authorize(auth.inviteToken, auth.participantId, auth.sessionToken);
    return this.prepare({ id: randomUUID(), kind, session_id: session.id, participant_id: auth.participantId, asset_id: randomUUID(), invite_token: auth.inviteToken, nickname: null, owner_hash: tokenHash(auth.sessionToken), session_token_hash: null, recovery_token_hash: null }, metadata);
  }

  private async prepare(base: Pick<UploadIntent, "id" | "kind" | "session_id" | "participant_id" | "asset_id" | "invite_token" | "nickname" | "owner_hash" | "session_token_hash" | "recovery_token_hash">, metadata: UploadMetadata) {
    const extension = metadata.contentType === "image/png" ? "png" : "jpg";
    const temporary_key = `uploads/${base.id}/source.${extension}`;
    // Persist before signing so every upload capability has a cleanup record.
    const intent: UploadIntent = { ...base, content_type: metadata.contentType, byte_size: metadata.size, temporary_key, final_key: `${base.session_id}/${base.asset_id}.${extension}`, expires_at: new Date(this.now().getTime() + 2 * 60 * 60 * 1000).toISOString(), status: "uploading", lease_token: null, lease_expires_at: null };
    await this.intents.insert(intent);
    const signed = await this.files.signUpload(temporary_key);
    return { uploadId: base.id, ...signed };
  }

  async completeUpload(uploadId: string, bootstrapToken?: string, auth?: UploadAuth) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(uploadId)) fail(404, "업로드를 찾을 수 없습니다.");
    let intent = await this.intents.find(uploadId);
    if (!intent) fail(404, "업로드를 찾을 수 없습니다.");
    const ownerHash = await this.authorizeIntent(intent, bootstrapToken, auth);
    if (new Date(intent.expires_at).getTime() <= this.now().getTime()) fail(410, "업로드 시간이 만료되었습니다. 사진을 다시 올려 주세요.");
    if (intent.status !== "ready") {
      const leaseToken = randomUUID();
      intent = await this.intents.claim(uploadId, ownerHash, leaseToken);
      if (intent.status !== "ready") {
        try {
          const bytes = await this.files.read(intent.temporary_key);
          if (bytes.length !== intent.byte_size) fail(400, "업로드한 파일 크기가 요청과 다릅니다.");
          let image: VerifiedImage;
          if (intent.kind === "original") image = await verifyPhotoBytes(bytes);
          else {
            const session = await this.sessions.authorize(auth!.inviteToken, auth!.participantId, auth!.sessionToken);
            const original = await this.database.findAsset(session.id, session.originalAssetId);
            if (!original) fail(404, "원본 파일을 찾을 수 없습니다.");
            image = intent.kind === "mask" ? await verifyMask(new File([new Uint8Array(bytes)], "mask.png", { type: intent.content_type }), original) : await verifyPhotoBytes(bytes, original);
          }
          if (image.contentType !== intent.content_type) fail(400, "사진 형식이 파일 정보와 다릅니다.");
          await this.files.putImmutable(intent.final_key, image.bytes, image.contentType);
          await this.intents.finalize(intent, ownerHash, leaseToken, image);
        } catch (error) {
          // Retain temporary/final bytes for safe retries; scheduled cleanup owns deletion.
          await this.intents.release(uploadId, leaseToken).catch(() => undefined);
          throw error;
        }
      }
    }
    if (intent.kind === "original") return this.originalResult(intent);
    await this.authorizeIntent(intent, bootstrapToken, auth);
    const asset = await this.database.findAsset(intent.session_id, intent.asset_id);
    if (!asset) fail(410, "파일의 보관 기간이 끝났습니다.");
    return { kind: "asset" as const, asset: publicAsset(asset) };
  }

  private async authorizeIntent(intent: UploadIntent, bootstrapToken?: string, auth?: UploadAuth) {
    if (intent.kind === "original") {
      if (!bootstrapToken || tokenHash(bootstrapToken) !== intent.owner_hash) fail(403, "이 업로드를 완료할 권한이 없습니다.");
      return intent.owner_hash;
    }
    if (!auth || auth.inviteToken !== intent.invite_token || auth.participantId !== intent.participant_id || tokenHash(auth.sessionToken) !== intent.owner_hash) fail(403, "이 업로드를 완료할 권한이 없습니다.");
    const session = await this.sessions.authorize(auth.inviteToken, auth.participantId, auth.sessionToken);
    if (session.id !== intent.session_id) fail(403, "다른 방의 업로드입니다.");
    return intent.owner_hash;
  }

  private async originalResult(intent: UploadIntent) {
    const session = await this.database.findSessionByInvite(intent.invite_token);
    if (!session || new Date(session.expiresAt).getTime() <= this.now().getTime()) fail(410, "이 작업의 보관 기간이 끝났습니다.");
    const secrets = originalUploadSecrets(intent.id, this.secret);
    const credential = await this.database.findCredentials(session.id, intent.participant_id);
    // Recovery rotates participation credentials. A stale upload replay must not revive them.
    if (!credential || credential.sessionTokenHash !== tokenHash(secrets.sessionToken) || credential.recoveryTokenHash !== tokenHash(secrets.recoveryToken)) fail(403, "참여증이 변경되었습니다. 개인 복구 링크를 사용해 주세요.");
    return { kind: "original" as const, session, participant: { id: intent.participant_id, sessionId: session.id, nickname: intent.nickname!, submitted: false }, ...secrets };
  }
}

function publicAsset(asset: PhotoAsset) { const { storageKey: _storageKey, ...rest } = asset; return rest; }
