import { NextResponse, type NextRequest } from "next/server";
import { unseal } from "@/lib/crypto";
import { GMAIL_COOKIE, googleConfig, isMockMode, requestOrigin } from "@/lib/google";
import { DELAY_RANGE_SEC } from "@/lib/send-queue";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const mock = isMockMode();
  const cfg = googleConfig(requestOrigin(req));
  return NextResponse.json(
    {
      connected: unseal(req.cookies.get(GMAIL_COOKIE)?.value) !== null,
      configured: mock || Boolean(cfg.clientId && cfg.clientSecret),
      mock,
      // the 20–60 s spacing is fixed in production; only the mock mode (dev/tests) shortens it
      delayRangeSec: mock ? [1, 2] : DELAY_RANGE_SEC,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
