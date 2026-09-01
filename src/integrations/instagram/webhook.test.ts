import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { parseInboundMessages, verifySubscription, verifyWebhookSignature } from "./webhook";

beforeAll(() => {
  Object.assign(process.env, {
    INSTAGRAM_APP_SECRET: "s3cr3t",
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify-me",
  });
});

describe("webhook signature", () => {
  it("accepts a correct sha256 signature", () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = "sha256=" + createHmac("sha256", "s3cr3t").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = "sha256=" + createHmac("sha256", "s3cr3t").update("{}").digest("hex");
    expect(verifyWebhookSignature('{"x":1}', sig)).toBe(false);
  });

  it("rejects a missing/garbage header", () => {
    expect(verifyWebhookSignature("{}", null)).toBe(false);
    expect(verifyWebhookSignature("{}", "sha256=zz")).toBe(false);
  });
});

describe("subscription handshake", () => {
  it("echoes the challenge when the verify token matches", () => {
    const p = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "verify-me",
      "hub.challenge": "12345",
    });
    expect(verifySubscription(p)).toBe("12345");
  });

  it("returns null on a bad token", () => {
    const p = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wrong" });
    expect(verifySubscription(p)).toBeNull();
  });
});

describe("parseInboundMessages", () => {
  it("extracts text DMs and skips echoes", () => {
    const payload = {
      entry: [
        {
          messaging: [
            { sender: { id: "u1" }, recipient: { id: "page" }, timestamp: 1, message: { mid: "m1", text: "oi" } },
            { sender: { id: "page" }, recipient: { id: "u1" }, timestamp: 2, message: { mid: "m2", text: "eco", is_echo: true } },
          ],
        },
      ],
    };
    const out = parseInboundMessages(payload);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: "m1", senderId: "u1", text: "oi" });
  });
});
