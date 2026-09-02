import { beforeAll, describe, expect, it } from "vitest";
import { generateOpener, isConstructionLead } from "./engine";
import { checkOutboundText } from "@/lib/claims";

beforeAll(() => {
  Object.assign(process.env, { CLAUDEIA_API_KEY: "offline" });
});

describe("isConstructionLead", () => {
  it("catches obra-related profiles", () => {
    expect(isConstructionLead({ bio: "Construtora em Maringá", category: null, displayName: null, niche: null })).toBe(true);
    expect(isConstructionLead({ bio: null, category: "Arquiteto(a)", displayName: null, niche: null })).toBe(true);
    expect(isConstructionLead({ bio: null, category: null, displayName: null, niche: null, sourceKeyword: "gestão de obras" })).toBe(true);
  });
  it("ignores unrelated profiles", () => {
    expect(isConstructionLead({ bio: "Clínica odontológica", category: "Dentista", displayName: null, niche: null })).toBe(false);
  });
});

describe("generateOpener (offline templates)", () => {
  const base = {
    funnel: "customer" as const,
    igUsername: "x",
    location: "Maringá, PR",
    niche: null,
    variantId: "opener_A",
  };

  it("leads with CronoObra for a construction lead and stays claim-safe", async () => {
    const msg = await generateOpener({
      ...base,
      displayName: "GRP Construtora",
      bio: "17 anos moldando o futuro de Maringá",
      category: "Construção",
      sourceKeyword: "construtora",
    });
    expect(msg.toLowerCase()).toContain("cronoobra");
    expect(msg.toLowerCase()).toContain("primeira obra");
    expect(checkOutboundText(msg).ok).toBe(true);
    expect(msg).not.toMatch(/[—–]/);
  });

  it("uses the generic pitch for a non-construction lead", async () => {
    const msg = await generateOpener({
      ...base,
      displayName: "Odonto Sorriso",
      bio: "Agende seu horário pelo WhatsApp",
      category: "Dentista",
      sourceKeyword: "clínica odontológica",
    });
    expect(msg.toLowerCase()).not.toContain("cronoobra");
    expect(msg.toLowerCase()).toContain("sob medida");
    expect(msg).not.toMatch(/[—–]/);
  });
});
