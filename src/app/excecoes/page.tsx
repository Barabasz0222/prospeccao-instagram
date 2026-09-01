import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { exceptions, integrationAlerts } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function ExcecoesPage() {
  const db = getDb();
  const [exc, alerts] = await Promise.all([
    db.select().from(exceptions).orderBy(desc(exceptions.createdAt)).limit(100),
    db.select().from(integrationAlerts).orderBy(desc(integrationAlerts.createdAt)).limit(50),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Fila de exceções</h1>
        {exc.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nada pendente.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {exc.map((e) => (
              <li key={e.id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
                <span className="font-medium">{e.kind}</span> · {e.status}
                {e.detail ? <div className="text-neutral-500">{e.detail}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-500">Alertas de integração</h2>
        {alerts.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Sem alertas.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
                [{a.severity}] {a.source}: {a.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
