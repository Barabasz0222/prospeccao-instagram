import { loadEnv } from "@/lib/env";
import { loadBusiness } from "@/lib/business";
import { getDb } from "@/db/client";
import { getSetting } from "@/features/settings/repo";
import { toggleFollowupAction, updateSettingAction } from "../leads/actions";

export const dynamic = "force-dynamic";

const TUNABLES: { key: string; label: string; fallback: number }[] = [
  { key: "leads.qualify_threshold", label: "Limiar de qualificação (0–1)", fallback: 0.4 },
  { key: "followup.delay_days", label: "Dias até o follow-up", fallback: 3 },
  { key: "followup.max", label: "Máximo de follow-ups", fallback: 1 },
  { key: "discovery.interval_hours", label: "Descoberta: intervalo (horas)", fallback: 12 },
  { key: "discovery.profiles_per_term", label: "Descoberta: perfis por termo", fallback: 3 },
  { key: "discovery.max_backlog", label: "Descoberta: pausar acima de N leads na fila", fallback: 300 },
  { key: "leads.stale_days", label: "Encerrar lead não contatado após N dias", fallback: 30 },
];

export default async function ConfiguracoesPage() {
  const db = getDb();
  const followupEnabled = await getSetting<boolean>(db, "followup.enabled", true);
  const tunables = await Promise.all(
    TUNABLES.map(async (t) => ({ ...t, value: await getSetting<number>(db, t.key, t.fallback) })),
  );
  let env: ReturnType<typeof loadEnv> | null = null;
  let envError: string | null = null;
  try {
    env = loadEnv();
  } catch (e) {
    envError = e instanceof Error ? e.message : String(e);
  }

  let business: ReturnType<typeof loadBusiness> | null = null;
  let bizError: string | null = null;
  try {
    business = loadBusiness();
  } catch (e) {
    bizError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Configurações</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Limites operacionais</h2>
        {envError ? (
          <pre className="whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {envError}
          </pre>
        ) : env ? (
          <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
            <Item k="DMs por dia" v={env.MAX_DMS_PER_DAY} />
            <Item k="Intervalo mín. (s)" v={env.MIN_SECONDS_BETWEEN_DMS} />
            <Item k="Intervalo máx. (s)" v={env.MAX_SECONDS_BETWEEN_DMS} />
            <Item k="Janela de operação" v={env.OPERATING_HOURS} />
            <Item k="Fuso horário" v={env.OPERATING_TIMEZONE} />
            <Item k="Orçamento IA/mês (USD)" v={env.CLAUDEIA_MONTHLY_BUDGET_USD} />
            <Item k="Modelo (redação)" v={env.CLAUDEIA_MODEL} />
            <Item k="Modelo (rápido)" v={env.CLAUDEIA_MODEL_FAST} />
            <Item k="Modo de envio" v={env.BROWSER_SEND_MODE} />
          </dl>
        ) : null}
        <p className="mt-2 text-xs text-neutral-500">
          Estes valores vêm do arquivo <code>.env</code>. Edite o arquivo e reinicie o sistema para alterá-los.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">
          Parâmetros ajustáveis (a IA também pode alterar dentro destes limites)
        </h2>
        <div className="space-y-2">
          <form action={toggleFollowupAction} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="enabled" value={followupEnabled ? "false" : "true"} />
            <label className="w-64 text-neutral-600 dark:text-neutral-400">
              Mandar follow-up (&quot;passando pra retomar&quot;) pra quem não respondeu
            </label>
            <span className={followupEnabled ? "text-emerald-600" : "text-neutral-500"}>
              {followupEnabled ? "Ligado" : "Desligado"}
            </span>
            <button className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
              {followupEnabled ? "Desligar" : "Ligar"}
            </button>
          </form>
          {tunables.map((t) => (
            <form key={t.key} action={updateSettingAction} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="key" value={t.key} />
              <label className="w-64 text-neutral-600 dark:text-neutral-400">{t.label}</label>
              <input
                name="value"
                defaultValue={String(t.value)}
                className="w-28 rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
                Salvar
              </button>
            </form>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Identidade do negócio</h2>
        {bizError ? (
          <pre className="whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {bizError}
          </pre>
        ) : business ? (
          <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
            <Item k="Empresa" v={business.company.name} />
            <Item k="Responsável" v={business.owner.name} />
            <Item k="Site" v={business.company.website} />
            <Item k="WhatsApp" v={business.links.whatsapp} />
            <Item k="Grupo de afiliados" v={business.links.affiliateGroup ?? "não configurado"} />
            <Item k="Afirmações verificadas" v={business.verifiedClaims.length} />
          </dl>
        ) : null}
      </section>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <dt className="text-xs text-neutral-500">{k}</dt>
      <dd className="mt-0.5 break-all font-medium">{String(v)}</dd>
    </div>
  );
}
