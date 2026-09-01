import { loadBusiness } from "@/lib/business";

/**
 * WhatsApp Business message templates. Only used if the operator later wires a
 * WhatsApp Business API number; until then the funnel just hands off the link.
 * Templates must be pre-approved by Meta and respect the 24h session window /
 * opt-in rules — enforced by `canSendTemplate`.
 */
export type WhatsAppTemplate = {
  name: string;
  language: "pt_BR";
  category: "utility" | "marketing";
  body: (vars: Record<string, string>) => string;
};

export const TEMPLATES: Record<string, WhatsAppTemplate> = {
  handoff_greeting: {
    name: "handoff_greeting",
    language: "pt_BR",
    category: "utility",
    body: (v) =>
      `Oi ${v.firstName ?? ""}! Aqui é ${loadBusiness().owner.name}, da ${loadBusiness().company.name}. ` +
      `Você falou com a gente no Instagram — seguimos por aqui?`,
  },
  followup_no_reply: {
    name: "followup_no_reply",
    language: "pt_BR",
    category: "utility",
    body: () =>
      `Passando pra retomar nossa conversa. Se ainda fizer sentido, me avisa que te mando os próximos passos. Se não, sem problema.`,
  },
};

export type OptInState = {
  optedIn: boolean;
  optInAt: string | null;
  lastInboundAt: string | null;
};

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A free-form message is allowed only inside the 24h window opened by the
 * contact's last inbound. Outside it, a pre-approved template is required and
 * only if the contact opted in.
 */
export function canSendWhatsApp(
  state: OptInState,
  mode: "freeform" | "template",
  now = Date.now(),
): { ok: boolean; reason?: string } {
  const inWindow = state.lastInboundAt
    ? now - new Date(state.lastInboundAt).getTime() < SESSION_WINDOW_MS
    : false;
  if (mode === "freeform") {
    return inWindow ? { ok: true } : { ok: false, reason: "fora da janela de 24h" };
  }
  if (!state.optedIn) return { ok: false, reason: "sem opt-in" };
  return { ok: true };
}
