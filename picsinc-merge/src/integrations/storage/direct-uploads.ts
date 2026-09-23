import "server-only";
import { createHash } from "node:crypto";
import { SessionError } from "@/features/photo-session/errors";
import { readBoundedUpload, type DirectUploadFiles, type DirectUploadRepository, type UploadIntent } from "@/features/photo-session/direct-uploads-service";
import type { VerifiedImage } from "@/features/photo-session/image-validation";
import { supabaseServer } from "./supabase-server";

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "picsinc-merge";
function checked(error: { message: string } | null) {
  if (!error) return;
  const statuses: Record<string, number> = { "Upload missing": 404, "Upload expired": 410, "Upload unauthorized": 403, "Upload busy": 409, "Upload lease lost": 409, "Session expired": 410 };
  const messages: Record<string, string> = { "Upload missing": "업로드를 찾을 수 없습니다.", "Upload expired": "업로드 시간이 만료되었습니다.", "Upload unauthorized": "이 업로드를 완료할 권한이 없습니다.", "Upload busy": "파일을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.", "Upload lease lost": "파일 확인이 중단되었습니다. 다시 시도해 주세요.", "Session expired": "이 작업의 보관 기간이 끝났습니다." };
  if (statuses[error.message]) throw new SessionError(statuses[error.message], messages[error.message]);
  throw new Error("Upload storage operation failed");
}

export class SupabaseDirectUploadRepository implements DirectUploadRepository {
  async insert(intent: UploadIntent) { const { error } = await supabaseServer().from("photo_upload_intents").insert(intent); checked(error); }
  async find(id: string) { const { data, error } = await supabaseServer().from("photo_upload_intents").select("*").eq("id", id).maybeSingle(); checked(error); return data as UploadIntent | null; }
  async claim(id: string, ownerHash: string, leaseToken: string) {
    const { data, error } = await supabaseServer().rpc("claim_photo_upload", { p_upload_id: id, p_owner_hash: ownerHash, p_lease_token: leaseToken }); checked(error); return data as UploadIntent;
  }
  async release(id: string, leaseToken: string) {
    const { error } = await supabaseServer().from("photo_upload_intents").update({ status: "uploading", lease_token: null, lease_expires_at: null }).eq("id", id).eq("lease_token", leaseToken).eq("status", "verifying"); checked(error);
  }
  async finalize(intent: UploadIntent, ownerHash: string, leaseToken: string, image: VerifiedImage) {
    const { error } = await supabaseServer().rpc(intent.kind === "original" ? "finalize_original_upload" : "finalize_session_upload", { p_upload_id: intent.id, p_owner_hash: ownerHash, p_lease_token: leaseToken, p_width: image.width, p_height: image.height, p_content_type: image.contentType }); checked(error);
  }
}

export class SupabaseDirectUploadFiles implements DirectUploadFiles {
  async signUpload(path: string) {
    const { data, error } = await supabaseServer().storage.from(bucket()).createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error("Cannot authorize photo upload");
    return data;
  }
  async read(path: string) {
    const { data, error } = await supabaseServer().storage.from(bucket()).createSignedUrl(path, 60);
    if (error || !data) throw new SessionError(400, "업로드한 파일을 찾을 수 없습니다.");
    return readBoundedUpload(await fetch(data.signedUrl, { cache: "no-store", signal: AbortSignal.timeout(60_000) }));
  }
  async putImmutable(path: string, bytes: Buffer, contentType: string) {
    const { error } = await supabaseServer().storage.from(bucket()).upload(path, bytes, { contentType, upsert: false });
    if (!error) return;
    // A previous finalize request can have written the file but lost its DB response.
    // Reuse only exactly equal bytes; never overwrite an immutable original.
    if (error.statusCode !== "409" && error.statusCode !== "400" && !/already exists|duplicate/i.test(error.message)) throw new Error("Cannot persist verified upload");
    const existing = await this.read(path);
    const digest = (body: Buffer) => createHash("sha256").update(body).digest("hex");
    if (existing.length !== bytes.length || digest(existing) !== digest(bytes)) throw new SessionError(409, "이미 저장된 파일과 내용이 다릅니다. 사진을 다시 올려 주세요.");
  }
}
