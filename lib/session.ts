import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";

/**
 * The GitHub OAuth token lives only in an httpOnly, AES-256-GCM encrypted cookie.
 * Nothing is stored server-side. Requires SESSION_SECRET (>= 32 random chars).
 */
const COOKIE = "nw_gh";

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  return createHash("sha256").update(s).digest();
}

export function seal(obj: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function unseal<T>(v: string): T | null {
  try {
    const b = Buffer.from(v, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export interface GhSession {
  token: string;
  login: string;
}

export async function getGhSession(): Promise<GhSession | null> {
  const v = (await cookies()).get(COOKIE)?.value;
  return v ? unseal<GhSession>(v) : null;
}

export async function setGhSession(s: GhSession) {
  (await cookies()).set(COOKIE, seal(s), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearGhSession() {
  (await cookies()).delete(COOKIE);
}

export const OAUTH_STATE_COOKIE = "nw_oauth_state";
