import { jsonRequest, request, RequestError } from "./client";
import type { FlowSnapshot } from "./flow-state";

// Ignore other participants' work, but never replace a change made by this
// participant on another device while this editor was open.
function ownWork(snapshot: FlowSnapshot): string {
  const id = snapshot.currentParticipantId;
  const original = snapshot.originalSelections.find(s => s.participantId === id);
  return JSON.stringify([
    snapshot.session.id, snapshot.session.originalAssetId, id,
    snapshot.participants.find(p => p.id === id)?.submitted,
    original ? [original.maskAssetId, [...original.selectedRegionIds].sort()] : null,
    snapshot.selections.filter(s => s.participantId === id).map(s => [s.editedAssetId, s.maskAssetId]).sort((a, b) => a[0].localeCompare(b[0])),
    snapshot.assets.filter(a => a.participantId === id && a.kind === "edited").map(a => a.id).sort(),
  ]);
}

export async function saveEditorSelection(input: {
  base: string; snapshot: FlowSnapshot; maskAssetId: string; selectedRegionIds: string[];
  editedAssetId?: string; saveOriginal: boolean; submit: boolean;
}, send: typeof request = request): Promise<void> {
  if (input.submit && !input.editedAssetId) throw new Error("보정본을 먼저 올려 주세요.");
  let baseline = structuredClone(input.snapshot);
  let retried = false;
  async function write(path: string, body: Record<string, unknown>) {
    while (true) {
      try {
        const saved = await send<{ version: number }>(`${input.base}/${path}`, jsonRequest({ ...body, expectedVersion: baseline.session.version }, "PUT"));
        baseline.session.version = saved.version;
        return;
      } catch (error) {
        if (!(error instanceof RequestError) || error.status !== 409 || error.code !== "SESSION_VERSION_CONFLICT" || retried) throw error;
        const fresh = await send<FlowSnapshot>(input.base);
        if (ownWork(fresh) !== ownWork(baseline)) throw new RequestError("다른 기기에서 내 작업이 변경됐어요. 현재 선택은 유지됩니다. 저장된 내용을 확인해주세요.", 409, "OWN_WORK_CHANGED");
        retried = true;
        baseline = fresh;
      }
    }
  }
  if (input.saveOriginal) {
    await write("original-selection", { maskAssetId: input.maskAssetId, selectedRegionIds: input.selectedRegionIds });
    // This successful write is ours; account for it before checking for a
    // conflict in the participant's second (submission) request.
    baseline.originalSelections = [...baseline.originalSelections.filter(s => s.participantId !== baseline.currentParticipantId), {
      participantId: baseline.currentParticipantId, maskAssetId: input.maskAssetId, selectedRegionIds: [...new Set(input.selectedRegionIds)],
    }];
    const me = baseline.participants.find(p => p.id === baseline.currentParticipantId);
    if (me) me.submitted = false;
  }
  if (input.submit) await write("selection", { maskAssetId: input.maskAssetId, editedAssetId: input.editedAssetId });
}
