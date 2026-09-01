/**
 * Pipeline and channel state machines. Internal values in English; the UI
 * layer translates. Pipeline and channel are independent fields on a lead.
 */

export const CUSTOMER_PIPELINE = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "whatsapp_handoff",
  "registered",
  "active_customer",
  "closed",
] as const;
export type CustomerStage = (typeof CUSTOMER_PIPELINE)[number];

export const AFFILIATE_PIPELINE = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "joined_affiliate_group",
  "active_affiliate",
  "generated_customer",
  "closed",
] as const;
export type AffiliateStage = (typeof AFFILIATE_PIPELINE)[number];

export const CHANNEL_STATES = [
  "browser_contact_pending",
  "browser_contact_sent",
  "waiting_inbound_reply",
  "api_eligible",
  "api_active",
  "api_window_closed",
  "human_review_required",
  "do_not_contact",
  "blocked",
  "completed",
] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

export type Funnel = "customer" | "affiliate";

const CUSTOMER_TRANSITIONS: Record<CustomerStage, CustomerStage[]> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "whatsapp_handoff", "closed"],
  interested: ["whatsapp_handoff", "closed"],
  whatsapp_handoff: ["registered", "closed"],
  registered: ["active_customer", "closed"],
  active_customer: ["closed"],
  closed: [],
};

const AFFILIATE_TRANSITIONS: Record<AffiliateStage, AffiliateStage[]> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["joined_affiliate_group", "closed"],
  joined_affiliate_group: ["active_affiliate", "closed"],
  active_affiliate: ["generated_customer", "closed"],
  generated_customer: ["closed"],
  closed: [],
};

const CHANNEL_TRANSITIONS: Record<ChannelState, ChannelState[]> = {
  browser_contact_pending: ["browser_contact_sent", "api_eligible", "blocked", "do_not_contact", "human_review_required"],
  browser_contact_sent: ["waiting_inbound_reply", "api_eligible", "blocked", "do_not_contact", "human_review_required"],
  waiting_inbound_reply: ["api_eligible", "do_not_contact", "human_review_required", "completed"],
  api_eligible: ["api_active", "api_window_closed", "do_not_contact", "human_review_required"],
  api_active: ["api_window_closed", "human_review_required", "do_not_contact", "completed"],
  api_window_closed: ["api_eligible", "human_review_required", "do_not_contact", "completed"],
  human_review_required: ["api_eligible", "waiting_inbound_reply", "do_not_contact", "completed", "blocked"],
  do_not_contact: [],
  blocked: ["human_review_required", "do_not_contact"],
  completed: [],
};

export function canTransitionPipeline(
  funnel: Funnel,
  from: string,
  to: string,
): boolean {
  const map = funnel === "customer" ? CUSTOMER_TRANSITIONS : AFFILIATE_TRANSITIONS;
  const allowed = (map as Record<string, string[]>)[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function canTransitionChannel(from: ChannelState, to: ChannelState): boolean {
  return CHANNEL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** do_not_contact is terminal and absorbing across every campaign and channel. */
export function isTerminalChannel(state: ChannelState): boolean {
  return state === "do_not_contact" || state === "completed";
}
