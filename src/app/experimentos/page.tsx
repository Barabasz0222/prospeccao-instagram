import { getDb } from "@/db/client";
import { experiments } from "@/db/schema";
import { analyzeExperiment } from "@/features/experiments/repo";

export const dynamic = "force-dynamic";

export default async function ExperimentosPage() {
  const db = getDb();
  const rows = await db.select().from(experiments);
  const analyses = await Promise.all(rows.map((e) => analyzeExperiment(db, e.key)));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Experimentos</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nenhum experimento configurado. Rode <code>pnpm tsx scripts/seed-demo.ts</code> para um exemplo.
        </p>
      ) : (
        analyses.filter(Boolean).map((a) => (
          <section key={a!.key} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">{a!.key}</h2>
                <p className="text-xs text-neutral-500">
                  variável: {a!.variable} · status: {a!.status}
                </p>
              </div>
              <div className="text-right text-xs text-neutral-500">
                {a!.totalAssigned}/{a!.targetSampleSize} atribuídos
                {a!.enoughData ? "" : " · amostra insuficiente"}
              </div>
            </div>

            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-neutral-500">
                <tr>
                  <th className="py-1">Variante</th>
                  <th>Atribuídos</th>
                  <th>Conversão</th>
                  <th>Resultados</th>
                </tr>
              </thead>
              <tbody>
                {a!.stats.map((s) => (
                  <tr key={s.variantId} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-1.5">
                      {s.label}
                      {s.isControl ? <span className="ml-1 text-xs text-neutral-500">(controle)</span> : null}
                      {a!.suggestedWinner === s.variantId ? (
                        <span className="ml-1 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                          líder
                        </span>
                      ) : null}
                    </td>
                    <td>{s.assigned}</td>
                    <td>{(s.conversionRate * 100).toFixed(1)}%</td>
                    <td className="text-xs text-neutral-500">
                      {Object.entries(s.outcomes)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!a!.enoughData && (
              <p className="mt-2 text-xs text-amber-600">
                Nenhum vencedor declarado antes de atingir a amostra alvo.
              </p>
            )}
          </section>
        ))
      )}
    </div>
  );
}
