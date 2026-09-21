import "@/lib/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Business } from "@/lib/business";

const BUSINESS_PATH = resolve(process.cwd(), "config/business.json");

export function readBusinessRaw(): Business | null {
  if (!existsSync(BUSINESS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BUSINESS_PATH, "utf8")) as Business;
  } catch {
    return null;
  }
}

export type WizardBusinessInput = {
  ownerName: string;
  ownerRole: string;
  companyName: string;
  website: string;
  instagramHandle: string;
  whatsappNumber: string;
  affiliateGroup: string;
  oneLinePitch: string;
  howItWorks: string;
  revenueModel: string;
  verifiedClaims: string;
  unverifiedClaims: string;
  segments: string;
  keywords: string;
  affiliateTopics: string;
  country: string;
  region: string;
};

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

/** Builds a schema-valid business.json from the simplified setup wizard. */
export function writeBusinessFromWizard(input: WizardBusinessInput): Business {
  const handle = normalizeHandle(input.instagramHandle);
  const digits = input.whatsappNumber.replace(/\D/g, "");

  const business: Business = {
    owner: { name: input.ownerName.trim(), role: input.ownerRole.trim() },
    company: {
      name: input.companyName.trim(),
      website: normalizeUrl(input.website),
      instagramHandle: handle,
      instagramUrl: `https://www.instagram.com/${handle}/`,
    },
    links: {
      whatsapp: digits ? `https://wa.me/${digits}` : normalizeUrl(input.whatsappNumber),
      affiliateGroup: input.affiliateGroup.trim() ? normalizeUrl(input.affiliateGroup) : null,
    },
    pitch: {
      oneLine: input.oneLinePitch.trim(),
      howItWorks: lines(input.howItWorks),
      revenueModel: lines(input.revenueModel),
    },
    marketJargon: {},
    verifiedClaims: lines(input.verifiedClaims),
    unverifiedClaims: lines(input.unverifiedClaims),
    icp: {
      segments: lines(input.segments),
      keywords: lines(input.keywords),
    },
    affiliateTopics: lines(input.affiliateTopics).length
      ? lines(input.affiliateTopics)
      : ["indicação de clientes"],
    geography: {
      country: input.country.trim() || "Brasil",
      region: input.region.trim() || "Brasil",
    },
  };

  writeFileSync(BUSINESS_PATH, JSON.stringify(business, null, 2) + "\n", "utf8");
  return business;
}
