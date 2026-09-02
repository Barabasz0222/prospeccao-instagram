import "@/lib/server-only-shim";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  owner: z.object({ name: z.string().min(1), role: z.string().min(1) }),
  company: z.object({
    name: z.string().min(1),
    website: z.string().url(),
    instagramHandle: z.string().min(1),
    instagramUrl: z.string().url(),
  }),
  links: z.object({
    whatsapp: z.string().url(),
    affiliateGroup: z.string().url().nullable(),
    cronoobra: z.string().url().optional(),
  }),
  pitch: z.object({
    oneLine: z.string().min(1),
    howItWorks: z.array(z.string().min(1)).min(1),
    revenueModel: z.array(z.string().min(1)).min(1),
  }),
  marketJargon: z.record(z.string()),
  verifiedClaims: z.array(z.string().min(1)).min(1),
  unverifiedClaims: z.array(z.string().min(1)),
  icp: z.object({
    segments: z.array(z.string().min(1)).min(1),
    keywords: z.array(z.string().min(1)).min(1),
  }),
  affiliateTopics: z.array(z.string().min(1)).min(1),
  geography: z.object({ country: z.string().min(1), region: z.string().min(1) }),
});

export type Business = z.infer<typeof schema>;

let cached: Business | null = null;

export function loadBusiness(): Business {
  if (cached) return cached;
  const path = resolve(process.cwd(), "config/business.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      "config/business.json não encontrado. Copie config/business.example.json e preencha.",
    );
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `config/business.json inválido:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  // Placeholder guard: refuse a business.json that still holds {{TOKENS}}.
  if (raw.includes("{{")) {
    throw new Error("config/business.json ainda contém placeholders {{...}}.");
  }
  cached = parsed.data;
  return cached;
}

export function resetBusinessCache(): void {
  cached = null;
}
