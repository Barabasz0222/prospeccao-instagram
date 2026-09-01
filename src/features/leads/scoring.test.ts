import { describe, expect, it } from "vitest";
import { loadBusiness } from "@/lib/business";
import type { Lead } from "@/db/schema";
import { priorityFromScore, scoreLead } from "./scoring";

function leadOf(p: Partial<Lead>): Lead {
  return {
    id: 1,
    funnel: "customer",
    igUsername: "x",
    igUserId: null,
    profileUrl: "https://instagram.com/x",
    displayName: null,
    bio: null,
    category: null,
    location: null,
    followerCount: null,
    actorType: "unknown",
    icpScore: null,
    niche: null,
    sourceKeyword: null,
    discoverySource: null,
    tags: [],
    pipelineStage: "discovered",
    channelState: "browser_contact_pending",
    priority: 0,
    bestSendWindow: null,
    nextActionAt: null,
    nextActionKind: null,
    publicSignals: null,
    createdAt: "",
    updatedAt: "",
    ...p,
  } as Lead;
}

describe("scoreLead", () => {
  const business = loadBusiness();

  it("scores an on-ICP civil-engineering owner in Paraná highly", () => {
    const r = scoreLead(
      leadOf({
        displayName: "EngBrasil Projetos",
        bio: "Engenharia civil · gestão de obras ainda na planilha · sócio fundador",
        category: "Serviço de engenharia",
        location: "Londrina, Paraná",
      }),
      business,
    );
    expect(r.icpScore).toBeGreaterThan(0.5);
    expect(["owner", "decision_maker"]).toContain(r.actorType);
    expect(priorityFromScore(r.icpScore, r.actorType)).toBeGreaterThanOrEqual(2);
  });

  it("scores an off-topic profile low", () => {
    const r = scoreLead(
      leadOf({ displayName: "Padaria da Esquina", bio: "Pães quentinhos toda manhã", category: "Padaria" }),
      business,
    );
    expect(r.icpScore).toBeLessThan(0.45);
  });

  it("detects a creator for the affiliate funnel", () => {
    const r = scoreLead(
      leadOf({
        funnel: "affiliate",
        bio: "Criador de conteúdo sobre automação de processos com IA",
        category: "Criador de conteúdo digital",
      }),
      business,
    );
    expect(r.actorType).toBe("creator");
  });
});
