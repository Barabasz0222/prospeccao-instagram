import { describe, expect, it } from "vitest";
import { loadBusiness } from "@/lib/business";
import type { Lead } from "@/db/schema";
import { scoreLead } from "./scoring";

function leadOf(p: Partial<Lead>): Lead {
  return {
    id: 1, funnel: "customer", igUsername: "x", igUserId: null,
    profileUrl: "https://instagram.com/x", displayName: null, bio: null, category: null,
    location: "Curitiba, Paraná", followerCount: 900, actorType: "unknown", icpScore: null,
    niche: null, sourceKeyword: null, discoverySource: null, tags: [], pipelineStage: "discovered",
    channelState: "browser_contact_pending", priority: 0, bestSendWindow: null, nextActionAt: null,
    nextActionKind: null, publicSignals: null, createdAt: "", updatedAt: "",
    ...p,
  } as Lead;
}

describe("pain vs vendor signals", () => {
  const business = loadBusiness();

  it("ranks a manual-operation small business above a bare listing", () => {
    const manual = scoreLead(
      leadOf({
        displayName: "Odonto Sorriso",
        bio: "Clínica odontológica · Agende seu horário pelo WhatsApp · atendimento com hora marcada",
        category: "Dentista",
        sourceKeyword: "clínica odontológica",
      }),
      business,
    );
    const bare = scoreLead(
      leadOf({ displayName: "Odonto Sorriso", bio: "Sorrisos que transformam", category: "Dentista" }),
      business,
    );
    expect(manual.icpScore).toBeGreaterThan(bare.icpScore);
    expect(manual.reasons.join(" ")).toMatch(/operação manual/);
  });

  it("penalizes an automation agency (a peer, not a client)", () => {
    const vendor = scoreLead(
      leadOf({
        displayName: "NextFlow Automação",
        bio: "Automação de processos e agentes de IA · criamos sistemas sob medida · chatbot e CRM",
        category: "Produto/serviço",
        sourceKeyword: "consultoria empresarial",
      }),
      business,
    );
    expect(vendor.icpScore).toBeLessThan(0.4);
    expect(vendor.reasons.join(" ")).toMatch(/fornecedor de software/);
  });
});
