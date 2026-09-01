/**
 * Popula o banco configurado (DATABASE_URL) com leads de demonstração e um
 * experimento A/B, para explorar o painel. Não envia nada.
 *
 *   pnpm tsx scripts/seed-demo.ts
 */
import { getDb } from "@/db/client";
import { experiments } from "@/db/schema";
import { discoverLead } from "@/features/leads/repo";
import { enqueue } from "@/worker/queue";

const db = getDb();

const CANDIDATES = [
  {
    funnel: "customer" as const,
    igUsername: "construtora.norte.pr",
    profileUrl: "https://instagram.com/construtora.norte.pr",
    displayName: "Construtora Norte PR",
    bio: "Obras comerciais e residenciais · Maringá/PR · orçamento sem compromisso",
    category: "Construção",
    location: "Maringá, PR",
    followerCount: 3200,
    sourceKeyword: "sistema para construtora",
    actorType: "owner" as const,
    icpScore: 0.82,
    niche: "construção civil",
    discoverySource: "seed-demo",
  },
  {
    funnel: "customer" as const,
    igUsername: "engbrasil.projetos",
    profileUrl: "https://instagram.com/engbrasil.projetos",
    displayName: "EngBrasil Projetos",
    bio: "Engenharia civil · gestão de obras ainda no Excel 😅",
    category: "Serviço de engenharia",
    location: "Londrina, PR",
    followerCount: 1200,
    sourceKeyword: "substituir planilha",
    actorType: "decision_maker" as const,
    icpScore: 0.9,
    niche: "engenharia",
    discoverySource: "seed-demo",
  },
  {
    funnel: "affiliate" as const,
    igUsername: "automatiza.ai",
    profileUrl: "https://instagram.com/automatiza.ai",
    displayName: "Automatiza.ai",
    bio: "Conteúdo sobre automação de processos com IA para PMEs",
    category: "Criador de conteúdo",
    location: "Curitiba, PR",
    followerCount: 18400,
    sourceKeyword: "automação de processos com inteligência artificial",
    actorType: "creator" as const,
    icpScore: 0.76,
    niche: "tech creator",
    discoverySource: "seed-demo",
  },
];

for (const c of CANDIDATES) {
  const res = await discoverLead(db, c);
  console.log(`${c.igUsername}: ${res.status}`);
  if (res.status === "created") {
    await enqueue(db, {
      kind: "send_first_dm",
      dedupeKey: `dm:${res.leadId}`,
      payload: {
        leadId: res.leadId,
        variantId: "opener_A",
        message:
          c.funnel === "customer"
            ? `Oi! Vi o perfil de vocês (${c.displayName}). A BraszTech desenvolve sistemas sob medida e tem um SaaS de gestão de obras já em uso real — posso te mostrar um caso rápido?`
            : `Oi! Acompanho seu conteúdo sobre automação. A BraszTech tem um programa de afiliados e eu queria te apresentar — topa uma conversa?`,
      },
    });
  }
}

await db
  .insert(experiments)
  .values({
    key: "opener_copy_v1",
    variable: "mensagem_de_abertura",
    status: "running",
    targetSampleSize: 120,
    variants: [
      { id: "opener_A", label: "Abertura com caso de uso", weight: 0.5, isControl: true },
      { id: "opener_B", label: "Abertura com pergunta de dor", weight: 0.5, isControl: false },
    ],
  })
  .onConflictDoNothing();

console.log("\nSeed concluído. Rode `pnpm dev` e abra http://localhost:3000");
process.exit(0);
