import type { RegionClaim } from "./types";

export class SessionError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "SessionError";
  }
}

// The heavy-task gate is a process-wide singleton, so its busy error can come from another
// bundled copy of this module (e.g. a different route in `next dev`). Match by name as well.
export function isSessionError(error: unknown): error is SessionError {
  return error instanceof SessionError
    || error instanceof Error && error.name === "SessionError" && typeof (error as { status?: unknown }).status === "number";
}

export class RegionClaimConflict extends SessionError {
  constructor(public readonly claim: RegionClaim) {
    super(409, `${claim.nickname}님이 선택한 영역이에요. 다른 얼굴을 선택해주세요.`);
    this.name = "RegionClaimConflict";
  }
}

export function fail(status: number, message: string, code?: string): never {
  throw new SessionError(status, message, code);
}
