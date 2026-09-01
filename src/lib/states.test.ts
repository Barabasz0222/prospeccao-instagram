import { describe, expect, it } from "vitest";
import {
  canTransitionChannel,
  canTransitionPipeline,
  isTerminalChannel,
} from "./states";

describe("pipeline transitions", () => {
  it("allows forward customer steps", () => {
    expect(canTransitionPipeline("customer", "discovered", "qualified")).toBe(true);
    expect(canTransitionPipeline("customer", "interested", "whatsapp_handoff")).toBe(true);
  });

  it("rejects skips and backward steps", () => {
    expect(canTransitionPipeline("customer", "discovered", "active_customer")).toBe(false);
    expect(canTransitionPipeline("customer", "replied", "discovered")).toBe(false);
  });

  it("keeps affiliate pipeline separate", () => {
    expect(canTransitionPipeline("affiliate", "interested", "joined_affiliate_group")).toBe(true);
    expect(canTransitionPipeline("affiliate", "interested", "whatsapp_handoff")).toBe(false);
  });
});

describe("channel transitions", () => {
  it("models the browser -> api handoff", () => {
    expect(canTransitionChannel("browser_contact_sent", "waiting_inbound_reply")).toBe(true);
    expect(canTransitionChannel("waiting_inbound_reply", "api_eligible")).toBe(true);
    expect(canTransitionChannel("api_eligible", "api_active")).toBe(true);
  });

  it("makes do_not_contact absorbing", () => {
    expect(isTerminalChannel("do_not_contact")).toBe(true);
    expect(canTransitionChannel("do_not_contact", "api_eligible")).toBe(false);
  });

  it("does not allow api to reopen a browser thread", () => {
    expect(canTransitionChannel("api_active", "browser_contact_sent")).toBe(false);
  });
});
