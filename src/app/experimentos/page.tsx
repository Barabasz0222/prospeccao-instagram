import { getDb } from "@/db/client";
import { experiments } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function ExperimentosPage() {
  const db = getDb();
  const rows = await db.select().from(experiments);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Experimentos</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum experimento configurado.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((e) => (
            <li key={e.id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="font-medium">{e.key}</div>
              <div className="text-neutral-500">
                variável: {e.variable} · status: {e.status} · amostra alvo: {e.targetSampleSize}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
