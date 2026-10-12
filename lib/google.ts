import { randomBytes } from "node:crypto";

/**
 * Minimal Google OAuth 2.0 (authorization-code flow) + Gmail send client using plain fetch.
 * Scope is gmail.send only. Tokens never touch the client or the backup file.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export const GMAIL_COOKIE = "muq_gmail";
export const OAUTH_STATE_COOKIE = "muq_oauth_state";

export type SendErrorCode = "reauth" | "quota" | "rejected" | "failed" | "not_connected";

export class GmailError extends Error {
  constructor(
    public code: SendErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

export const GMAIL_ERROR_MESSAGES_AR: Record<SendErrorCode, string> = {
  reauth: "انتهى ربط Gmail (يحدث كل 7 أيام في وضع الاختبار). أعد ربط Gmail ثم تابع.",
  quota: "وصلت لحد الإرسال في Gmail. توقّف الإرسال، جرّب لاحقاً.",
  rejected: "رفض Gmail الرسالة. تحقق من عنوان المستلم.",
  failed: "تعذّر الإرسال عبر Gmail. حاول مرة أخرى.",
  not_connected: "Gmail غير مربوط. اربطه أولاً من صفحة الإرسال.",
};

/** Origin as the browser sees it (behind Vercel's proxy the forwarded headers carry it). */
export function requestOrigin(req: { headers: Headers; nextUrl: { protocol: string; host: string } }): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function googleConfig(origin: string) {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${origin}/api/gmail/callback`,
  };
}

export const isMockMode = () => process.env.GMAIL_MODE === "mock" && process.env.NODE_ENV !== "production";

export const newState = () => randomBytes(24).toString("base64url");

export function buildAuthUrl(cfg: { clientId: string; redirectUri: string }, state: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline", // refresh token
    prompt: "consent", // always return a refresh token
    include_granted_scopes: "false",
    state,
  }).toString();
  return u.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<{ ok: boolean; data: TokenResponse }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ok: res.ok, data };
}

/** Exchanges the callback `code`; returns the refresh token, or throws GmailError. */
export async function exchangeCode(cfg: ReturnType<typeof googleConfig>, code: string): Promise<string> {
  const { ok, data } = await tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  if (!ok || !data.refresh_token) throw new GmailError("failed", "no refresh token");
  if (!(data.scope ?? "").split(" ").includes(GMAIL_SCOPE)) throw new GmailError("failed", "scope not granted");
  return data.refresh_token;
}

export async function accessTokenFromRefresh(cfg: ReturnType<typeof googleConfig>, refreshToken: string): Promise<string> {
  const { ok, data } = await tokenRequest({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  });
  if (ok && data.access_token) return data.access_token;
  // invalid_grant = revoked / expired (7-day limit for apps in Testing mode)
  if (data.error === "invalid_grant" || data.error === "invalid_client" || data.error === "unauthorized_client") {
    throw new GmailError("reauth", data.error);
  }
  throw new GmailError("failed", data.error ?? "token refresh failed");
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    /* best effort */
  }
}

/** users.messages.send. Maps Google's errors to codes the client acts on. */
export async function sendRaw(accessToken: string, raw: string): Promise<string> {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (res.ok) return ((await res.json().catch(() => ({}))) as { id?: string }).id ?? "";

  const body = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; errors?: { reason?: string }[] };
  };
  const reasons = (body.error?.errors ?? []).map((e) => e.reason ?? "").join(",");
  if (res.status === 401) throw new GmailError("reauth", "unauthorized");
  if (res.status === 429 || /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded/i.test(reasons)) {
    throw new GmailError("quota", reasons || "rate limit");
  }
  if (res.status === 403 && /insufficientPermissions|authError/i.test(reasons)) {
    throw new GmailError("reauth", reasons); // scope revoked
  }
  if (res.status === 400) throw new GmailError("rejected", reasons || "bad request");
  throw new GmailError("failed", `status ${res.status}`);
}
