import { loadEnv } from "@/lib/env";
import { loadBusiness } from "@/lib/business";

export const dynamic = "force-dynamic";

export default function ConfiguracoesPage() {
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
