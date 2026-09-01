import { describe, expect, it } from "vitest";
import { detectOptOut } from "./engine";

describe("detectOptOut", () => {
  it("catches explicit stop requests, accent-insensitive", () => {
    expect(detectOptOut("Não quero receber mais mensagens")).toBe(true);
    expect(detectOptOut("PARA DE me mandar isso")).toBe(true);
    expect(detectOptOut("quero me descadastrar")).toBe(true);
  });

  it("does not fire on normal replies", () => {
    expect(detectOptOut("quero saber mais sobre o sistema")).toBe(false);
    expect(detectOptOut("me manda o preço")).toBe(false);
  });
});
