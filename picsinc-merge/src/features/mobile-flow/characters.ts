const base = "/images/figma-current/home/";

// Figma 527:3097 (함께 보정): host lilac, then mint, peach.
export const roomCharacters = ["lilac", "mint", "peach", "pink", "sky"] as const;
// Figma 586:13466 (사진 합치기): host lilac, then pink.
export const mergeCharacters = ["lilac", "pink", "mint", "peach", "sky"] as const;

/** Host first, then everyone else in join order, so each person keeps one color on every screen and phone. */
export function characterFor(palette: readonly string[], participantIds: string[], ownerId: string | undefined, id: string) {
  const order = ownerId ? [ownerId, ...participantIds.filter(other => other !== ownerId)] : participantIds;
  const index = Math.max(0, order.indexOf(id));
  return `${base}${palette[index % palette.length]}.png`;
}
