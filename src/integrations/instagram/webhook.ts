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

type MessagingEntry = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number | string;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

function toInbound(m: MessagingEntry): InboundMessage | null {
  if (!m.message || m.message.is_echo || !m.message.text || !m.message.mid) return null;
  const ts = m.timestamp ? Number(m.timestamp) : Date.now();
  return {
    externalId: m.message.mid,
    senderId: m.sender?.id ?? "",
    recipientId: m.recipient?.id ?? "",
    text: m.message.text,
    timestamp: new Date(ts < 1e12 ? ts * 1000 : ts).toISOString(),
  };
}

/**
 * Extracts inbound DM events. Handles the real webhook shape
 * (`entry[].messaging[]` / `entry[].changes[].value`) and the bare
 * `{ field, value }` shape the Meta dashboard "Test" button sends.
 */
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const body = payload as {
    field?: string;
    value?: MessagingEntry;
    entry?: {
      messaging?: MessagingEntry[];
      changes?: { field?: string; value?: MessagingEntry }[];
    }[];
  };

  // Meta dashboard test payload: { field: "messages", value: {...} }
  if (body.field === "messages" && body.value) {
    const m = toInbound(body.value);
    if (m) out.push(m);
  }

  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const parsed = toInbound(m);
      if (parsed) out.push(parsed);
    }
    for (const c of entry.changes ?? []) {
      if (c.field === "messages" && c.value) {
        const parsed = toInbound(c.value);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}
