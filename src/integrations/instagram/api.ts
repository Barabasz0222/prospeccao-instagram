import "@/lib/server-only-shim";
import { log } from "@/lib/logger";

const GRAPH = "https://graph.instagram.com/v21.0";

/** Standard 24h messaging window for human_agent-free replies. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinMessagingWindow(lastInboundAt: string | null, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  return now - new Date(lastInboundAt).getTime() < MESSAGING_WINDOW_MS;
}

export type SendResult =
  | { status: "sent"; externalId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export type SendPreconditions = {
  recipientOptedOut: boolean;
  channelOwner: "browser" | "api" | "none";
  lastInboundAt: string | null;
  /** Live access token (from the settings-backed store). */
  accessToken?: string | null;
};

/**
 * Sends a DM via the official API. Refuses if the channel is not owned by the
 * API, the recipient opted out, or the 24h window has closed. Never falls back
 * to the browser.
 */
export async function sendApiMessage(
  recipientId: string,
  text: string,
  pre: SendPreconditions,
): Promise<SendResult> {
  if (pre.recipientOptedOut) return { status: "skipped", reason: "recipient_opted_out" };
  if (pre.channelOwner !== "api") return { status: "skipped", reason: "channel_not_api" };
  if (!isWithinMessagingWindow(pre.lastInboundAt)) return { status: "skipped", reason: "api_window_closed" };

  const token = pre.accessToken ?? process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;

  // Offline / simulation: no real Graph API call.
  if (!token || token === "test" || token === "dev" || process.env.CLAUDEIA_API_KEY === "offline") {
    return { status: "sent", externalId: `sim-${Date.now()}` };
  }

  try {
    const res = await fetch(`${GRAPH}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    });
    const data = (await res.json()) as { message_id?: string; error?: { message?: string } };
    if (!res.ok || data.error) {
      return { status: "failed", error: data.error?.message ?? `HTTP ${res.status}` };
    }
    return { status: "sent", externalId: data.message_id ?? `api-${Date.now()}` };
  } catch (e) {
    log.error("instagram.api.send_failed", { error: e instanceof Error ? e.message : String(e) });
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
