import { loadBusiness } from "@/lib/business";

/**
 * Returns the correct handoff link for the funnel. Customers go to the
 * WhatsApp link; affiliates go to the affiliate group link when configured,
 * otherwise they also fall back to WhatsApp.
 */
export function handoffLink(funnel: "customer" | "affiliate"): {
  url: string;
  kind: "whatsapp" | "affiliate_group";
} {
  const business = loadBusiness();
  if (funnel === "affiliate" && business.links.affiliateGroup) {
    return { url: business.links.affiliateGroup, kind: "affiliate_group" };
  }
  return { url: business.links.whatsapp, kind: "whatsapp" };
}

export function withPrefilledText(baseUrl: string, text: string): string {
  const u = new URL(baseUrl);
  if (u.hostname.includes("wa.me") || u.hostname.includes("whatsapp")) {
    u.searchParams.set("text", text);
  }
  return u.toString();
}
