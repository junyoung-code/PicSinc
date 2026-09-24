import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import "server-only";
import { RegionClaimConflict, SessionError } from "@/features/photo-session/errors";
import type { CompositeResult, OverlapAssignment, Participant, PhotoAsset, Selection } from "@/core/contracts";
import type { CredentialRecord, NewAsset, PhotoSessionStore, RegionClaim, SessionRecord, SessionSnapshot } from "@/features/photo-session/types";
import { supabaseServer } from "./supabase-server";

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "picsinc-merge";
const rowSession = (row: any): SessionRecord => ({ id: row.id, ownerParticipantId: row.owner_participant_id, originalAssetId: row.original_asset_id, version: row.version, createdAt: row.created_at, expiresAt: row.expires_at, inviteToken: row.invite_token });
const rowParticipant = (row: any): Participant => ({ id: row.id, sessionId: row.session_id, nickname: row.nickname, submitted: row.submitted });
const rowAsset = (row: any): PhotoAsset => ({ id: row.id, sessionId: row.session_id, participantId: row.participant_id, kind: row.kind, storageKey: row.storage_key, width: row.width, height: row.height, contentType: row.content_type, uploadOrder: row.upload_order ?? null });
const rowCredentials = (row: any): CredentialRecord => ({ participantId: row.participant_id, sessionId: row.session_id, sessionTokenHash: row.session_token_hash, recoveryTokenHash: row.recovery_token_hash });

export class SupabasePhotoSessionStore implements PhotoSessionStore {
  private db() { return supabaseServer() as any; }
  private check(error: any) {
    if (!error) return;
    if (error.message === "Session expired") throw new SessionError(410, "이 작업의 보관 기간이 끝났습니다.");
    if (error.message === "Region claim conflict" && error.details) throw new RegionClaimConflict(JSON.parse(error.details));
    if (error.message === "Region claim required") throw new SessionError(409, "선택 상태가 바뀌었어요. 얼굴을 다시 선택해주세요.");
    if (error.message === "Invalid region") throw new SessionError(400, "원본에서 검출된 ID를 선택해 주세요.");
    if (error.message === "Forbidden") throw new SessionError(403, "이 작업을 수정할 권한이 없습니다.");
    throw new Error(error.message);
  }

  async createSession(input: { session: SessionRecord; participant: Participant; credentials: CredentialRecord; original: NewAsset }) {
    const db = this.db();
    const { error } = await db.rpc("create_photo_session", {
      p_session_id: input.session.id, p_invite_token: input.session.inviteToken, p_original_asset_id: input.session.originalAssetId,
      p_created_at: input.session.createdAt, p_expires_at: input.session.expiresAt, p_participant_id: input.participant.id, p_nickname: input.participant.nickname,
      p_session_token_hash: input.credentials.sessionTokenHash, p_recovery_token_hash: input.credentials.recoveryTokenHash,
      p_storage_key: input.original.storageKey, p_width: input.original.width, p_height: input.original.height, p_content_type: input.original.contentType,
    }); this.check(error);
  }
  async findSessionByInvite(inviteToken: string) { const { data, error } = await this.db().from("photo_sessions").select("*").eq("invite_token", inviteToken).maybeSingle(); this.check(error); return data ? rowSession(data) : null; }
  async findCredentials(sessionId: string, participantId: string) { const { data, error } = await this.db().from("participant_credentials").select("*").eq("session_id", sessionId).eq("participant_id", participantId).maybeSingle(); this.check(error); return data ? rowCredentials(data) : null; }
  async findCredentialsByRecovery(sessionId: string, recoveryTokenHash: string) { const { data, error } = await this.db().from("participant_credentials").select("*").eq("session_id", sessionId).eq("recovery_token_hash", recoveryTokenHash).maybeSingle(); this.check(error); return data ? rowCredentials(data) : null; }
  async replaceSessionToken(sessionId: string, participantId: string, sessionTokenHash: string) { const { error } = await this.db().from("participant_credentials").update({ session_token_hash: sessionTokenHash }).eq("session_id", sessionId).eq("participant_id", participantId); this.check(error); }
  async createParticipant(input: { participant: Participant; credentials: CredentialRecord }) {
    const { error } = await this.db().rpc("join_photo_session", { p_session_id: input.participant.sessionId, p_participant_id: input.participant.id, p_nickname: input.participant.nickname, p_session_token_hash: input.credentials.sessionTokenHash, p_recovery_token_hash: input.credentials.recoveryTokenHash }); this.check(error);
  }
  async snapshot(sessionId: string): Promise<SessionSnapshot | null> {
    const { data, error } = await this.db().rpc("photo_session_snapshot", { p_session_id: sessionId }); this.check(error);
    if (!data) return null;
    return { session: rowSession(data.session), participants: data.participants.map(rowParticipant), assets: data.assets.map(rowAsset), originalSelections: data.original_selections.map((row: any) => ({ participantId: row.participant_id, maskAssetId: row.mask_asset_id, selectedRegionIds: row.selected_region_ids })), selections: data.selections.map((row: any): Selection => ({ participantId: row.participant_id, editedAssetId: row.edited_asset_id, maskAssetId: row.mask_asset_id })), overlapAssignments: data.overlaps.map((row: any): OverlapAssignment => ({ editedAssetId: row.edited_asset_id, maskAssetId: row.mask_asset_id })), result: data.result };
  }
  async publishComposition(result: CompositeResult, assets: NewAsset[], participantId: string) {
    const { data, error } = await this.db().rpc("publish_composition", { p_result: result, p_assets: assets, p_participant_id: participantId }); this.check(error); return data === true;
  }
  async createAsset(asset: NewAsset) { const { data, error } = await this.db().rpc("register_photo_asset", { p_asset: asset }); this.check(error); return rowAsset(data); }
  async findAsset(sessionId: string, assetId: string) { const { data, error } = await this.db().from("photo_assets").select("*").eq("session_id", sessionId).eq("id", assetId).maybeSingle(); this.check(error); return data ? rowAsset(data) : null; }
  async replaceSelection(input: { sessionId: string; participantId: string; editedAssetId: string; maskAssetId: string; expectedVersion: number; submitted: boolean }) { const { data, error } = await this.db().rpc("replace_selection", { p_session_id: input.sessionId, p_participant_id: input.participantId, p_edited_asset_id: input.editedAssetId, p_mask_asset_id: input.maskAssetId, p_expected_version: input.expectedVersion, p_submitted: input.submitted }); this.check(error); return data === null ? null : Number(data); }
  async replaceOverlapAssignments(input: { sessionId: string; participantId: string; assignments: OverlapAssignment[]; expectedVersion: number }) { const { data, error } = await this.db().rpc("replace_overlap_assignments", { p_participant_id: input.participantId, p_session_id: input.sessionId, p_assignments: input.assignments.map((item) => ({ edited_asset_id: item.editedAssetId, mask_asset_id: item.maskAssetId })), p_expected_version: input.expectedVersion }); this.check(error); return data === null ? null : Number(data); }
  async replaceOriginalSelection(input: { sessionId: string; participantId: string; maskAssetId: string; selectedRegionIds: string[]; expectedVersion: number }) {
    const { data, error } = await this.db().rpc("replace_original_selection", { p_session_id: input.sessionId, p_participant_id: input.participantId, p_mask_asset_id: input.maskAssetId, p_selected_region_ids: input.selectedRegionIds, p_expected_version: input.expectedVersion }); this.check(error); return data === null ? null : Number(data);
  }
  async findOriginalDetection(sessionId: string): Promise<DetectedRegions | null> { const { data, error } = await this.db().from("original_detections").select("detection").eq("session_id", sessionId).maybeSingle(); this.check(error); return data?.detection ?? null; }
  async listRegionClaims(sessionId: string): Promise<RegionClaim[]> {
    const { data, error } = await this.db().rpc("list_region_claims", { p_session_id: sessionId });
    this.check(error); return data;
  }
  async setRegionClaim(input: { sessionId: string; participantId: string; regionId: string; selected: boolean }): Promise<{ claims: RegionClaim[]; conflict?: RegionClaim }> {
    const { data, error } = await this.db().rpc("set_region_claim", { p_session_id: input.sessionId, p_participant_id: input.participantId, p_region_id: input.regionId, p_selected: input.selected });
    this.check(error); return data;
  }
  async cacheOriginalDetection(sessionId: string, detection: DetectedRegions, requestId?: string): Promise<DetectedRegions> {
    const { data, error, status } = await this.db().rpc("cache_original_detection", { p_session_id: sessionId, p_detection: detection });
    if (error) console.error("photo region cache RPC failed", JSON.stringify({
      requestId,
      status,
      code: typeof error.code === "string" ? error.code : undefined,
      message: typeof error.message === "string" ? error.message.slice(0, 500) : undefined,
      details: typeof error.details === "string" ? error.details.slice(0, 500) : undefined,
      hint: typeof error.hint === "string" ? error.hint.slice(0, 500) : undefined,
    }));
    this.check(error);
    return data;
  }
  async findExpired(now: string) { const { data, error } = await this.db().from("photo_sessions").select("id").lte("expires_at", now); this.check(error); return Promise.all(data.map((row: any) => this.snapshot(row.id))).then((all) => all.filter((entry): entry is SessionSnapshot => Boolean(entry))); }
  async deleteSession(sessionId: string) { const { error } = await this.db().from("photo_sessions").delete().eq("id", sessionId); this.check(error); }
}

export class SupabasePrivateFileStore {
  async put(key: string, body: Buffer, contentType: string) { const { error } = await (supabaseServer() as any).storage.from(bucket()).upload(key, body, { contentType, upsert: false }); if (error) throw new Error(error.message); }
  async get(key: string) { const { data, error } = await (supabaseServer() as any).storage.from(bucket()).download(key); if (error) throw new Error(error.message); return data as Blob; }
  async remove(keys: string[]) { if (!keys.length) return; const { error } = await (supabaseServer() as any).storage.from(bucket()).remove(keys); if (error) throw new Error(error.message); }
}
