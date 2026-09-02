import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { enqueue } from "@/worker/queue";
import {
  parseInboundMessages,
  verifySubscription,
  verifyWebhookSignature,
} from "@/integrations/instagram/webhook";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: Meta subscription handshake. */
export function GET(req: NextRequest) {
  const challenge = verifySubscription(req.nextUrl.searchParams);
  if (challenge == null) {
    return new NextResponse("forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

/** POST: inbound events. Verifies signature, stores raw, enqueues processing. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const valid = verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"));
  if (!valid) {
    log.warn("webhook.bad_signature");
    return new NextResponse("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  const messages = parseInboundMessages(payload);
  const db = getDb();

  if (messages.length === 0) {
    // No DM extracted — could be a reaction/seen/echo event, or a payload
    // shape the parser doesn't cover yet. Log the raw so we can adjust.
    log.info("webhook.no_message", { rawSnippet: raw.slice(0, 800) });
  }

  for (const m of messages) {
    try {
      await db.insert(webhookEvents).values({
        provider: "instagram",
        externalId: m.externalId,
        payload: m as unknown as Record<string, unknown>,
        signatureValid: true,
      });
    } catch {
      // Duplicate delivery — already recorded, skip enqueue.
      continue;
    }
    await enqueue(db, {
      kind: "process_inbound",
      payload: {
        metaUserId: m.senderId,
        externalId: m.externalId,
        text: m.text,
        receivedAt: m.timestamp,
      },
      dedupeKey: `inbound:${m.externalId}`,
      priority: 10,
    });
  }

  return NextResponse.json({ received: messages.length });
}
