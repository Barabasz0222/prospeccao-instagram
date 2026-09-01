import "@/lib/server-only-shim";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadEnv } from "@/lib/env";

/** Verifies the X-Hub-Signature-256 header against the raw request body. */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const { INSTAGRAM_APP_SECRET } = loadEnv();
  const expected = createHmac("sha256", INSTAGRAM_APP_SECRET).update(rawBody).digest("hex");
  const got = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(got, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** GET verification handshake (hub.challenge). */
export function verifySubscription(params: URLSearchParams): string | null {
  const { INSTAGRAM_WEBHOOK_VERIFY_TOKEN } = loadEnv();
  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  ) {
    return params.get("hub.challenge");
  }
  return null;
}

export type InboundMessage = {
  externalId: string;
  senderId: string;
  recipientId: string;
  text: string;
  timestamp: string;
};

/** Extracts inbound DM events from a Messenger/Instagram webhook payload. */
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const body = payload as {
    entry?: {
      messaging?: {
        sender?: { id?: string };
        recipient?: { id?: string };
        timestamp?: number;
        message?: { mid?: string; text?: string; is_echo?: boolean };
      }[];
    }[];
  };
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (!m.message || m.message.is_echo || !m.message.text || !m.message.mid) continue;
      out.push({
        externalId: m.message.mid,
        senderId: m.sender?.id ?? "",
        recipientId: m.recipient?.id ?? "",
        text: m.message.text,
        timestamp: new Date((m.timestamp ?? Date.now())).toISOString(),
      });
    }
  }
  return out;
}
