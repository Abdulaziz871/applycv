import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "muq_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is missing or too short");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "family" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

/** Returns the token's subject ("family" for browser sessions, "extension" for the Chrome extension). */
async function tokenSubject(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await tokenSubject(token)) === "family";
}

// ---- Chrome extension (LinkedIn auto-apply): bearer token limited to a few API routes ----

export const EXTENSION_TOKEN_MAX_AGE = 60 * 60 * 24 * 90; // 90 days
export const EXTENSION_API_PATHS = ["/api/tailor", "/api/pdf", "/api/linkedin/answer"];

export async function createExtensionToken(): Promise<string> {
  return new SignJWT({ sub: "extension" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EXTENSION_TOKEN_MAX_AGE}s`)
    .sign(secretKey());
}

/** `Authorization: Bearer <token>` is accepted only for EXTENSION_API_PATHS. */
export async function verifyExtensionRequest(
  pathname: string,
  authorization: string | null | undefined,
): Promise<boolean> {
  if (!EXTENSION_API_PATHS.includes(pathname)) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  return (await tokenSubject(m?.[1])) === "extension";
}

/** Constant-time password comparison (hashes first so lengths are equal). */
export function passwordMatches(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---- in-memory login rate limiting (per server instance; good enough here) ----
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 6;
const fails = new Map<string, { count: number; first: number }>();

export function loginBlockedFor(ip: string, now = Date.now()): number {
  const rec = fails.get(ip);
  if (!rec) return 0;
  if (now - rec.first > WINDOW_MS) {
    fails.delete(ip);
    return 0;
  }
  return rec.count >= MAX_FAILS ? Math.ceil((rec.first + WINDOW_MS - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string, now = Date.now()) {
  const rec = fails.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) fails.set(ip, { count: 1, first: now });
  else rec.count++;
}

export function clearLoginFailures(ip: string) {
  fails.delete(ip);
}

export function __resetRateLimitForTests() {
  fails.clear();
}
