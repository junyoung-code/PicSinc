export class SessionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function fail(status: number, message: string): never {
  throw new SessionError(status, message);
}
