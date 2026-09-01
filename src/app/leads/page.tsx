import Link from "next/link";
import { getKanban, CHANNEL_LABELS } from "@/features/leads/queries";
import type { Funnel } from "@/lib/states";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ funil?: string }>;
}) {
  const { funil } = await searchParams;
  const funnel: Funnel = funil === "affiliate" ? "affiliate" : "customer";
  const columns = await getKanban(funnel);
  const total = columns.reduce((s, c) => s + c.leads.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Kanban</h1>
        <div className="flex gap-1 text-sm">
          <FunnelTab active={funnel === "customer"} href="/leads?funil=customer" label="Clientes" />
          <FunnelTab active={funnel === "affiliate"} href="/leads?funil=affiliate" label="Afiliados" />
        </div>
        <span className="text-xs text-neutral-500">{total} leads</span>
      </div>

      {total === 0 ? (
        <p className="text-sm text-neutral-500">
          Nenhum lead neste funil ainda. O worker cria leads ao rodar a descoberta.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.stage} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-neutral-500">
                <span>{col.label}</span>
                <span>{col.leads.length}</span>
              </div>
              <div className="space-y-2">
                {col.leads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="block rounded-lg border border-neutral-200 p-3 text-sm hover:border-neutral-400 dark:border-neutral-800"
                  >
                    <div className="font-medium">@{l.igUsername}</div>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {l.actorType} · score {l.icpScore ?? "—"} · prio {l.priority}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {CHANNEL_LABELS[l.channelState] ?? l.channelState}
                    </div>
                    {l.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.tags.slice(0, 3).map((t) => (
                          <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FunnelTab({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded px-2 py-1 ${
        active ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-200 dark:border-neutral-800"
      }`}
    >
      {label}
    </Link>
  );
}
