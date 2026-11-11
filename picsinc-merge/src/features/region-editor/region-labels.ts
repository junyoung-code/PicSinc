import type { DetectedRegions } from "./detected-regions";
import type { ViewTransform } from "./contour-geometry";

export interface RegionClaim { regionId: string; participantId: string; nickname: string }

export function regionOwnerLabel(regionId: string, claims: RegionClaim[], selectedIds: string[], participantId?: string, nickname?: string) {
  const claim = claims.find(value => value.regionId === regionId);
  if (claim) {
    const own = claim.participantId === participantId;
    return { own, text: `${claim.nickname}${own ? " (나)" : ""}` };
  }
  return selectedIds.includes(regionId) ? { own: true, text: `${nickname || "내 영역"}${nickname ? " (나)" : ""}` } : null;
}

// "로" after a vowel or ㄹ, "으로" after other final consonants, "(으)로" when the last letter is not Hangul.
export function withRo(name: string) {
  const code = name.trim().codePointAt(name.trim().length - 1) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return "(으)로";
  const finalConsonant = (code - 0xac00) % 28;
  return finalConsonant === 0 || finalConsonant === 8 ? "로" : "으로";
}

// Labels use CSS pixels so they stay readable while the image is zoomed.
export function regionLabelPosition(box: DetectedRegions["regions"][number]["box"], view: ViewTransform, viewport: { width: number; height: number }, labelWidth: number) {
  const left = box.x * view.scale + view.x, top = box.y * view.scale + view.y;
  const right = left + box.width * view.scale, bottom = top + box.height * view.scale;
  if (right <= 0 || bottom <= 0 || left >= viewport.width || top >= viewport.height) return null;
  return {
    x: Math.max(4, Math.min(viewport.width - labelWidth - 4, (left + right - labelWidth) / 2)),
    y: Math.max(4, Math.min(viewport.height - 28, top - 26)),
  };
}
