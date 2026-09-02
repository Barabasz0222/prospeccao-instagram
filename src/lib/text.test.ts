import { describe, expect, it } from "vitest";
import { stripDashes } from "./text";

describe("stripDashes", () => {
  it("replaces sentence-break dashes with a comma", () => {
    expect(stripDashes("Sou o Lucas — da BraszTech")).toBe("Sou o Lucas, da BraszTech");
    expect(stripDashes("BraszTech—a gente cria sistemas")).toBe("BraszTech, a gente cria sistemas");
    expect(stripDashes("Vi seu perfil - achei interessante")).toBe("Vi seu perfil, achei interessante");
  });

  it("keeps hyphens inside words and URLs", () => {
    expect(stripDashes("guarda-chuva e wa.me/5544991096525")).toBe("guarda-chuva e wa.me/5544991096525");
    expect(stripDashes("CRECI J-4111 em Sarandi")).toBe("CRECI J-4111 em Sarandi");
    expect(stripDashes("teste em cronoobra.com.br")).toBe("teste em cronoobra.com.br");
  });

  it("does not leave doubled punctuation", () => {
    expect(stripDashes("olha isso — . fim")).toBe("olha isso. fim");
  });
});
