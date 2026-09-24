import type { RegionClaim } from "./types";

export class SessionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export class RegionClaimConflict extends SessionError {
  constructor(public readonly claim: RegionClaim) {
    super(409, `${claim.nickname}님이 선택한 영역이에요. 다른 얼굴을 선택해주세요.`);
  }
}

export function fail(status: number, message: string): never {
  throw new SessionError(status, message);
}
