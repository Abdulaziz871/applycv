import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  clearLoginFailures,
  createSessionToken,
  loginBlockedFor,
  passwordMatches,
  recordLoginFailure,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { clientIp, jsonError } from "@/lib/api";

export const runtime = "nodejs";

const bodySchema = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  if (!process.env.APP_PASSWORD || !process.env.SESSION_SECRET) {
    return jsonError("إعدادات الخادم ناقصة (APP_PASSWORD / SESSION_SECRET).", 500);
  }
  const ip = clientIp(req);
  const wait = loginBlockedFor(ip);
  if (wait > 0) {
    return jsonError(`محاولات كثيرة. حاول بعد ${Math.ceil(wait / 60)} دقيقة.`, 429);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("أدخل كلمة السر.");

  if (!passwordMatches(parsed.data.password)) {
    recordLoginFailure(ip);
    return jsonError("كلمة السر غير صحيحة.", 401);
  }

  clearLoginFailures(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
