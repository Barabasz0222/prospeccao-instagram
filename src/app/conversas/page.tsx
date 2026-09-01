import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations, leads, messages } from "@/db/schema";
import { CHANNEL_LABELS } from "@/features/leads/queries";

export const dynamic = "force-dynamic";

export default async function ConversasPage() {
  const db = getDb();
  const rows = await db
    .select({
      convId: conversations.id,
      leadId: conversations.leadId,
      owner: conversations.ownerChannel,
      lastInboundAt: conversations.lastInboundAt,
      lastOutboundAt: conversations.lastOutboundAt,
      igUsername: leads.igUsername,
      funnel: leads.funnel,
      channelState: leads.channelState,
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .orderBy(desc(conversations.updatedAt))
    .limit(100);

  const lastByConv = new Map<number, string>();
  for (const r of rows) {
    const [m] = await db
      .select({ body: messages.body })
      .from(messages)
      .where(eq(messages.conversationId, r.convId))
      .orderBy(desc(messages.sentAt))
      .limit(1);
    if (m) lastByConv.set(r.convId, m.body);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Conversas</h1>
      <p className="text-xs text-neutral-500">
        Prospecção apenas — separada das mensagens pessoais do Instagram.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhuma conversa ainda.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.convId} className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <div className="flex items-center justify-between">
                <Link href={`/leads/${r.leadId}`} className="font-medium hover:underline">
                  @{r.igUsername}
                </Link>
                <span className="text-xs text-neutral-500">
                  {r.funnel === "customer" ? "Clientes" : "Afiliados"} · dono: {r.owner} ·{" "}
                  {CHANNEL_LABELS[r.channelState] ?? r.channelState}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-neutral-600 dark:text-neutral-400">
                {lastByConv.get(r.convId) ?? "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
