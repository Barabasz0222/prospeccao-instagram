import { getDb } from "@/db/client";
import { getDashboardSummary } from "@/features/dashboard/queries";
import { getSetting, isSystemPaused, SETTING_KEYS } from "@/features/settings/repo";
import { loadEnv } from "@/lib/env";
import { togglePauseAction } from "./actions";

export const dynamic = "force-dynamic";

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

function Card({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const db = getDb();
  const [summary, paused, pauseReason, env] = await Promise.all([
    getDashboardSummary(),
    isSystemPaused(db),
    getSetting<string>(db, SETTING_KEYS.pauseReason, ""),
    Promise.resolve(loadEnvSafe()),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Painel geral</h1>
        <form action={togglePauseAction}>
          <input type="hidden" name="reason" value="Pausa manual pelo operador" />
          <button
            className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
              paused ? "bg-emerald-600" : "bg-red-600"
            }`}
          >
            {paused ? "Retomar operação" : "Pausar tudo"}
          </button>
        </form>
      </div>

      {paused ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Sistema pausado{pauseReason ? `: ${pauseReason}` : ""}. Nenhum envio será feito.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card title="Respostas (7 dias)" value={String(summary.repliesLast7d)} />
        <Card title="Exceções abertas" value={String(summary.openExceptions)} />
        <Card title="Jobs na fila" value={String(summary.pendingJobs)} hint={`${summary.deadJobs} em dead-letter`} />
        <Card title="Custo de IA (total)" value={brl(summary.aiSpendUsd)} />
        <Card
          title="Custo de IA por lead"
          value={summary.costPerLeadUsd == null ? "—" : brl(summary.costPerLeadUsd)}
        />
        <Card
          title="Custo por cliente ativo"
          value={summary.costPerActiveCustomerUsd == null ? "—" : brl(summary.costPerActiveCustomerUsd)}
        />
        <Card title="Orçamento mensal de IA" value={env ? brl(env.budget) : "—"} />
        <Card title="Modo de envio (navegador)" value={env?.mode ?? "—"} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Pipeline por etapa</h2>
        <StageTable data={summary.leadsByStage} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Estado do canal</h2>
        <StageTable data={summary.leadsByChannel} />
      </section>
    </div>
  );
}

function StageTable({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum lead ainda.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="rounded-full border border-neutral-200 px-3 py-1 text-xs dark:border-neutral-800"
        >
          {k}: <strong>{v}</strong>
        </span>
      ))}
    </div>
  );
}

function loadEnvSafe(): { budget: number; mode: string } | null {
  try {
    const env = loadEnv();
    return { budget: env.CLAUDEIA_MONTHLY_BUDGET_USD, mode: env.BROWSER_SEND_MODE };
  } catch {
    return null;
  }
}
