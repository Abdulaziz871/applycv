import { NextResponse, type NextRequest } from "next/server";
import { seal } from "@/lib/crypto";
import {
  buildAuthUrl,
  GMAIL_COOKIE,
  googleConfig,
  isMockMode,
  newState,
  OAUTH_STATE_COOKIE,
  requestOrigin,
} from "@/lib/google";

export const runtime = "nodejs";

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/** Starts the Google OAuth flow (authorization code, gmail.send, offline access). */
export async function GET(req: NextRequest) {
  // relative Location: the browser resolves it against the host it is actually using
  const back = (status: string) => new NextResponse(null, { status: 307, headers: { Location: `/send?gmail=${status}` } });

  if (isMockMode()) {
    // dev/test only: pretend the account is connected, no Google involved
    const res = back("connected");
    res.cookies.set(GMAIL_COOKIE, seal("mock-refresh-token"), { ...cookieBase, maxAge: 60 * 60 * 24 * 30 });
    return res;
  }

  const cfg = googleConfig(requestOrigin(req));
  if (!cfg.clientId || !cfg.clientSecret) return back("misconfigured");

  const state = newState();
  const res = NextResponse.redirect(buildAuthUrl(cfg, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, { ...cookieBase, maxAge: 600 });
  return res;
}
