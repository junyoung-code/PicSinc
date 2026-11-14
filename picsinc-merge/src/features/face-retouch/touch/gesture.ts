import { restoreTouch, type EditState, type Point } from "../state/model";
import { splitDrag } from "./coordinates";
import { MAX_IMAGE_SIDE } from "../image-io/headers";

export type TouchMode = "touch" | "restore";
type TouchSnapshot = Pick<EditState, "strokes" | "restores">;
type Gesture = {
  before: TouchSnapshot; owner: string; mode: TouchMode; start: Point; last: Point;
  radius: number; strength: number; changed: boolean;
};

// Transient gesture history never changes the persisted EditState contract.
// Undo restores only touch data; facial sliders changed later remain intact.
export class TouchGesture {
  current: Gesture | null = null;
  private history: TouchSnapshot[] = [];
  get canUndo() { return this.history.length > 0; }

  begin(state: EditState, owner: string, mode: TouchMode, point: Point, radius: number, strength: number) {
    this.current = { before: { strokes: state.strokes, restores: state.restores }, owner, mode,
      start: point, last: point, radius, strength, changed: false };
  }

  move(state: EditState, point: Point, allowed = true): EditState {
    const g = this.current;
    if (!g) return state;
    const from = g.last;
    g.last = point; // Never bridge across a rejected segment.
    if (!allowed) return state;
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    if (!Number.isFinite(distance) || distance > Math.SQRT2 * MAX_IMAGE_SIDE) return state;
    let next = state;
    if (g.mode === "touch") {
      const strokes = splitDrag(g.owner, from, point, g.radius, g.strength);
      if (strokes.length) next = { ...state, strokes: [...state.strokes, ...strokes] };
    } else {
      next = restoreTouch(state, g.owner, point, g.radius, from);
    }
    g.changed ||= next !== state;
    return next;
  }

  finish(state: EditState, cancel = false): EditState {
    const g = this.current;
    this.current = null;
    if (!g?.changed) return state;
    if (cancel) return { ...state, ...g.before };
    this.history.push(g.before);
    if (this.history.length > 30) this.history.shift();
    return state;
  }

  undo(state: EditState): EditState {
    if (this.current) return state;
    const before = this.history.pop();
    return before ? { ...state, ...before } : state;
  }

  reset() { this.current = null; this.history = []; }
}
