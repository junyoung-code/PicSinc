type DisplayAsset = { id: string; participantId: string | null; kind: string; uploadOrder: number | null };
type DisplayParticipant = { id: string; nickname: string };

// Presentation only: composition keeps its own overlap precedence.
export function editedPhotoDisplay<A extends DisplayAsset, P extends DisplayParticipant>(assets: A[], participants: P[]) {
  const uploads = assets.filter(asset => asset.kind === "edited").sort((a, b) =>
    (a.uploadOrder ?? Infinity) - (b.uploadOrder ?? Infinity) || a.id.localeCompare(b.id));
  const firstUpload = new Map<string | null, number>();
  for (const [index, asset] of uploads.entries()) if (!firstUpload.has(asset.participantId)) firstUpload.set(asset.participantId, index);
  const rank = (id: string | null) => firstUpload.get(id) ?? Infinity;
  const orderedParticipants = [...participants].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  const names = new Map(participants.map(p => [p.id, p.nickname]));
  const counts = new Map<string | null, number>();
  const labels: Record<string, string> = {};
  for (const asset of uploads) {
    const number = (counts.get(asset.participantId) ?? 0) + 1;
    counts.set(asset.participantId, number);
    const nickname = names.get(asset.participantId ?? "") ?? "참여자";
    labels[asset.id] = number === 1 ? nickname : `${nickname} ${number}`;
  }
  const edits = [...uploads].sort((a, b) => rank(a.participantId) - rank(b.participantId));
  return { edits, participants: orderedParticipants, labels };
}
