import type {
  BrowserDriver,
  DiscoveredProfile,
  DiscoverQuery,
  ProfileSignals,
  SendDmInput,
  SendDmResult,
} from "./types";

const FIXTURE_BIOS = [
  "Engenharia civil e gestão de obras · orçamento sem compromisso · sócio fundador",
  "Construtora · obras residenciais e comerciais em Maringá",
  "Automação de processos com IA para pequenas empresas · criador de conteúdo",
  "Loja de materiais de construção · atendimento CNPJ",
  "Escritório de arquitetura e engenharia · Paraná",
];

function slugOf(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "") || "lead";
}

/** Deterministic fixture generator keyed off the query term. */
function fixtureProfiles(query: DiscoverQuery): DiscoveredProfile[] {
  const slug = slugOf(query.term);
  return Array.from({ length: query.limit }, (_, i) => ({
    igUsername: `${slug}.demo${i + 1}`,
    profileUrl: `https://instagram.com/${slug}.demo${i + 1}`,
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

  async enrichProfile(igUsername: string): Promise<ProfileSignals | null> {
    // Derive a plausible profile from the handle so simulation scores vary.
    const n = [...igUsername].reduce((s, c) => s + c.charCodeAt(0), 0);
    const bio = FIXTURE_BIOS[n % FIXTURE_BIOS.length]!;
    return {
      igUsername,
      profileUrl: `https://www.instagram.com/${igUsername}/`,
      displayName: igUsername.replace(/\./g, " "),
      bio,
      category: n % 2 ? "Serviço de engenharia" : "Construção",
      location: "Maringá, Paraná",
      followerCount: 800 + (n % 40) * 300,
      followingCount: 400 + (n % 20) * 50,
      postCount: 20 + (n % 200),
      externalUrl: n % 3 ? "https://exemplo.com.br" : null,
      isPrivate: false,
      isVerified: false,
      bioHashtags: [],
    };
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
