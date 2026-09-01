import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeadDetail, STAGE_LABELS, CHANNEL_LABELS } from "@/features/leads/queries";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getLeadDetail(Number(id));
  if (!data) notFound();
  const { lead, conversation, timeline } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leads" className="text-xs text-neutral-500 hover:underline">
          ← Kanban
        </Link>
        <h1 className="mt-1 text-xl font-semibold">@{lead.igUsername}</h1>
        <a
          href={lead.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          Abrir perfil no Instagram
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <Field k="Funil" v={lead.funnel === "customer" ? "Clientes" : "Afiliados"} />
        <Field k="Etapa" v={STAGE_LABELS[lead.pipelineStage] ?? lead.pipelineStage} />
        <Field k="Canal" v={CHANNEL_LABELS[lead.channelState] ?? lead.channelState} />
        <Field k="Tipo" v={lead.actorType} />
        <Field k="Score ICP" v={lead.icpScore ?? "—"} />
        <Field k="Prioridade" v={lead.priority} />
        <Field k="Nicho" v={lead.niche ?? "—"} />
        <Field k="Origem" v={lead.discoverySource ?? "—"} />
        <Field k="Palavra-chave" v={lead.sourceKeyword ?? "—"} />
        <Field k="Local" v={lead.location ?? "—"} />
        <Field k="Dono do canal" v={conversation?.ownerChannel ?? "—"} />
        <Field
          k="Janela da API"
          v={conversation?.apiWindowExpiresAt ? new Date(conversation.apiWindowExpiresAt).toLocaleString("pt-BR") : "—"}
        />
      </dl>

      {lead.bio && (
        <div className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <div className="text-xs text-neutral-500">Bio</div>
          <p className="mt-1 whitespace-pre-wrap">{lead.bio}</p>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Linha do tempo</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-neutral-500">Sem eventos ainda.</p>
        ) : (
          <ol className="space-y-2">
            {timeline.map((t, i) => (
              <li key={i} className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>
                    <Badge kind={t.kind} /> {t.title}
                  </span>
                  <time>{new Date(t.at).toLocaleString("pt-BR")}</time>
                </div>
                {t.detail && <p className="mt-1 whitespace-pre-wrap">{t.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <dt className="text-xs text-neutral-500">{k}</dt>
      <dd className="mt-0.5 break-all font-medium">{String(v)}</dd>
    </div>
  );
}

function Badge({ kind }: { kind: "message" | "event" | "decision" }) {
  const map = { message: "💬", event: "•", decision: "🤖" };
  return <span>{map[kind]}</span>;
}
