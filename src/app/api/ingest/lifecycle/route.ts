import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { applyCustomerSignal, type CustomerSignal } from "@/features/leads/lifecycle";
import { loadEnv } from "@/lib/env";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const { INGEST_TOKEN } = loadEnv();
  if (!INGEST_TOKEN) return false; // endpoint disabled until a token is set
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(INGEST_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * External lifecycle signals (CRM, billing, affiliate portal) that advance a
 * lead's pipeline: registered, active_customer, affiliate_joined,
 * affiliate_generated_customer. Bearer-token protected.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return new NextResponse("unauthorized", { status: 401 });

  let body: CustomerSignal;
  try {
    body = (await req.json()) as CustomerSignal;
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }
  if (!body?.type) return NextResponse.json({ ok: false, reason: "missing_type" }, { status: 400 });

  const result = await applyCustomerSignal(getDb(), body);
  log.info("ingest.lifecycle", { type: body.type, ...result });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
