import { describe, expect, it } from "vitest";
import { canSendWhatsApp, TEMPLATES } from "./templates";

describe("canSendWhatsApp", () => {
  const now = Date.parse("2026-03-10T12:00:00Z");

  it("allows freeform inside the 24h window", () => {
    expect(
      canSendWhatsApp({ optedIn: false, optInAt: null, lastInboundAt: "2026-03-10T06:00:00Z" }, "freeform", now),
    ).toEqual({ ok: true });
  });

  it("blocks freeform outside the window", () => {
    const r = canSendWhatsApp(
      { optedIn: true, optInAt: "x", lastInboundAt: "2026-03-08T06:00:00Z" },
      "freeform",
      now,
    );
    expect(r.ok).toBe(false);
  });

  it("requires opt-in for a template outside the window", () => {
    expect(
      canSendWhatsApp({ optedIn: false, optInAt: null, lastInboundAt: null }, "template", now).ok,
    ).toBe(false);
    expect(
      canSendWhatsApp({ optedIn: true, optInAt: "x", lastInboundAt: null }, "template", now).ok,
    ).toBe(true);
  });

  it("renders a template body", () => {
    expect(TEMPLATES.handoff_greeting!.body({ firstName: "Lucas" })).toContain("Lucas");
  });
});
