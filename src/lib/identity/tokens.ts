import { randomBytes, createHash } from "node:crypto";

// Invite tokens follow the same rule as passwords: the raw secret travels in the
// emailed link and is shown to the user once; only its HASH is stored, so a leak
// of the database does not yield usable invite links.

export interface IssuedToken {
  /** The raw token to embed in the invite link. Never persisted. */
  raw: string;
  /** SHA-256 of the raw token, stored in invite.tokenHash. */
  hash: string;
}

export function issueToken(): IssuedToken {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
