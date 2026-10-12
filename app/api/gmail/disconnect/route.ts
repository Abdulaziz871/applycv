import { NextResponse, type NextRequest } from "next/server";
import { unseal } from "@/lib/crypto";
import { GMAIL_COOKIE, isMockMode, revokeToken } from "@/lib/google";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = unseal(req.cookies.get(GMAIL_COOKIE)?.value);
  if (token && !isMockMode()) await revokeToken(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GMAIL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
