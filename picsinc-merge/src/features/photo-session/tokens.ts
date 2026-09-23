import { createHash, randomBytes } from "node:crypto";

export function createSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
