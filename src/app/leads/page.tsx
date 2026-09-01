import { getDb } from "@/db/client";
import { leads } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const db = getDb();
  const rows = await db.select().from(leads).orderBy(desc(leads.updatedAt)).limit(100);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Leads</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nenhum lead ainda. A descoberta cria leads automaticamente quando o worker roda.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="py-2">@</th>
                <th>Funil</th>
                <th>Tipo</th>
                <th>Score</th>
                <th>Etapa</th>
                <th>Canal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-2">{l.igUsername}</td>
                  <td>{l.funnel === "customer" ? "Clientes" : "Afiliados"}</td>
                  <td>{l.actorType}</td>
                  <td>{l.icpScore ?? "—"}</td>
                  <td>{l.pipelineStage}</td>
                  <td>{l.channelState}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
