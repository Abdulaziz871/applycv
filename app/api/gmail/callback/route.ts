import { NextResponse, type NextRequest } from "next/server";
import { seal } from "@/lib/crypto";
import { exchangeCode, GMAIL_COOKIE, googleConfig, OAUTH_STATE_COOKIE, requestOrigin } from "@/lib/google";

export const runtime = "nodejs";

/**
 * OAuth redirect target. The refresh token is stored ONLY in an AES-GCM encrypted httpOnly
 * cookie (per browser); nothing is written to a database, localStorage or the backup file.
 */
export async function GET(req: NextRequest) {
  const done = (status: string) => {
    const res = new NextResponse(null, { status: 307, headers: { Location: `/send?gmail=${status}` } });
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return done("denied");

  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const state = params.get("state");
  const code = params.get("code");
  if (!expected || !state || state !== expected || !code) return done("error");

  try {
    const refreshToken = await exchangeCode(googleConfig(requestOrigin(req)), code);
    const res = done("connected");
    res.cookies.set(GMAIL_COOKIE, seal(refreshToken), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch {
    return done("error");
  }
}
