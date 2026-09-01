import { describe, expect, it } from "vitest";
import { checkOutboundText } from "./claims";

describe("verified-claims guard", () => {
  it("passes a plain, truthful opener", () => {
    const text =
      "Oi! Vi que vocês tocam obras em Maringá. A BraszTech desenvolve sistemas sob medida — posso te mostrar um caso?";
    expect(checkOutboundText(text).ok).toBe(true);
  });

  it("blocks percentages / invented rates", () => {
    const r = checkOutboundText("Reduzimos 40% do seu tempo operacional.");
    expect(r.ok).toBe(false);
  });

  it("blocks guarantees and superlatives", () => {
    expect(checkOutboundText("Garantimos o melhor sistema do mercado.").ok).toBe(false);
  });

  it("blocks paraphrase of an unverified claim", () => {
    // unverifiedClaims: "Automações da BraszTech aumentam o faturamento das empresas"
    const r = checkOutboundText(
      "Com nossas automações a BraszTech aumentam bastante o faturamento das empresas parceiras.",
    );
    expect(r.ok).toBe(false);
  });

  it("blocks promises of account approval", () => {
    expect(checkOutboundText("Cuidamos da aprovação da sua conta.").ok).toBe(false);
  });
});
