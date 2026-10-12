import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyExtensionRequest, verifySessionToken } from "@/lib/auth";

/** Every page and API route requires the signed session cookie, except login. */
const PUBLIC_PATHS = ["/login", "/api/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  let ok = false;
  try {
    ok =
      (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) ||
      (await verifyExtensionRequest(pathname, request.headers.get("authorization")));
  } catch {
    ok = false; // missing SESSION_SECRET → nothing is accessible
  }
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "غير مصرّح. سجّل الدخول أولاً." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // static assets and the (non-secret) bundled fonts stay public
  matcher: ["/((?!_next/|fonts/|favicon.ico|icon.svg).*)"],
};
