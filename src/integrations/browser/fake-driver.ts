import type {
  BrowserDriver,
  DiscoveredProfile,
  DiscoverQuery,
  SendDmInput,
  SendDmResult,
} from "./types";

/** Deterministic fixture generator keyed off the query term. */
function fixtureProfiles(query: DiscoverQuery): DiscoveredProfile[] {
  const slug = query.term.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const bios = [
    "Engenharia civil e gestão de obras · orçamento sem compromisso",
    "Construtora · obras residenciais e comerciais · sócio fundador",
    "Automação de processos com IA para pequenas empresas · criador de conteúdo",
    "Loja de materiais de construção · atendimento CNPJ",
    "Escritório de arquitetura e engenharia · Paraná",
  ];
  return Array.from({ length: query.limit }, (_, i) => ({
    igUsername: `${slug}.demo${i + 1}`,
    profileUrl: `https://instagram.com/${slug}.demo${i + 1}`,
    displayName: `${query.term} demo ${i + 1}`,
    bio: bios[i % bios.length],
    category: i % 2 ? "Serviço de engenharia" : "Construção",
    location: "Maringá, Paraná",
    followerCount: 500 + i * 130,
  }));
}

/**
 * In-memory browser driver for simulation mode and tests. Records every call
 * and returns a deterministic "sent" result unless told otherwise. No real
 * Chrome, no network — safe to run in any environment (container, CI).
 */
export class FakeBrowserDriver implements BrowserDriver {
  readonly sent: SendDmInput[] = [];
  healthy = true;
  nextResult: SendDmResult | null = null;

  async healthCheck() {
    return this.healthy
      ? { ok: true }
      : { ok: false, reason: "fake driver marcado como indisponível" };
  }

  async discoverProfiles(query: DiscoverQuery): Promise<DiscoveredProfile[]> {
    return fixtureProfiles(query);
  }

  async sendDm(input: SendDmInput): Promise<SendDmResult> {
    this.sent.push(input);
    if (this.nextResult) {
      const r = this.nextResult;
      this.nextResult = null;
      return r;
    }
    return {
      status: "sent",
      evidence: { url: `${input.profileUrl}` },
    };
  }
}
