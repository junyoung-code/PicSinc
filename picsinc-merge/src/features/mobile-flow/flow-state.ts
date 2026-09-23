import type { CompositeResult, OriginalSelection, Participant, PhotoAsset, PhotoSession, Selection } from "@/core/contracts";
export type Step = "invite" | "select" | "guide" | "upload" | "review" | "status" | "result" | "overlap";
export interface FlowSnapshot {
  session: PhotoSession & { inviteToken: string };
  participants: Participant[];
  currentParticipantId: string;
  assets: Omit<PhotoAsset, "storageKey">[];
  originalSelections: OriginalSelection[];
  selections: Selection[];
  result?: CompositeResult | null;
}
export const steps: Step[] = ["invite", "select", "guide", "upload", "review", "status", "result", "overlap"];
export function resumeStep(data: FlowSnapshot): Step {
  const me = data.participants.find(p => p.id === data.currentParticipantId);
  const owner = data.session.ownerParticipantId === data.currentParticipantId;
  if (owner && data.result?.version === data.session.version) return "result";
  if (me?.submitted) return data.result?.version === data.session.version ? "result" : "status";
  if (owner) return data.originalSelections.some(s => s.participantId === data.currentParticipantId) ? "upload" : "select";
  return data.assets.some(a => a.kind === "edited" && a.participantId === data.currentParticipantId) ? "select" : "guide";
}
export function allowedStep(requested: string | null, data: FlowSnapshot): Step {
  if (!steps.includes(requested as Step)) return resumeStep(data);
  const step = requested as Step;
  const owner = data.session.ownerParticipantId === data.currentParticipantId;
  if (step === "invite" && !owner) return resumeStep(data);
  if (step === "overlap" && (!owner || !data.result)) return resumeStep(data);
  if (step === "result" && !data.result) return resumeStep(data);
  if (step === "select" && !owner && !data.assets.some(a => a.kind === "edited" && a.participantId === data.currentParticipantId)) return "guide";
  if (step === "upload" && owner && !data.originalSelections.some(s => s.participantId === data.currentParticipantId)) return "select";
  if (step === "review" && !data.originalSelections.some(s => s.participantId === data.currentParticipantId)) return owner ? "select" : "guide";
  if (step === "review" && !data.assets.some(a => a.kind === "edited" && a.participantId === data.currentParticipantId)) return "upload";
  return step;
}
