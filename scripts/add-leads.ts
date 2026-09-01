/**
 * Adiciona leads manualmente a partir de um arquivo de texto (um @ por linha,
 * opcional "| nicho/observação" depois). Enfileira score_lead para cada um;
 * leads manuais pulam o limiar de qualificação e vão direto pra 1ª DM.
 *
 *   cp leads.example.txt leads.txt  (uma vez)
 *   pnpm add-leads                 # lê leads.txt
 *   pnpm add-leads meus-leads.txt
 *   pnpm add-leads --funnel affiliate
 */
import "./_env";
import { existsSync, readFileSync } from "node:fs";
import { getDb } from "@/db/client";
import { enqueue } from "@/worker/queue";
import { discoverLead } from "@/features/leads/repo";

const args = process.argv.slice(2);
const funnelArg = args.includes("--funnel") ? args[args.indexOf("--funnel") + 1] : "customer";
const funnel = funnelArg === "affiliate" ? "affiliate" : "customer";
const file = args.find((a) => !a.startsWith("--") && a !== funnelArg) ?? "leads.txt";

if (!existsSync(file)) {
  console.error(`Arquivo não encontrado: ${file}`);
  process.exit(1);
}

const lines = readFileSync(file, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (lines.length === 0) {
  console.error(`Nenhum lead em ${file}. Adicione um @ por linha.`);
  process.exit(1);
}

const db = getDb();
let created = 0;
let dup = 0;
let blocked = 0;

for (const line of lines) {
  const [rawUser, ...rest] = line.split("|");
  const username = rawUser!.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
  const note = rest.join("|").trim() || undefined;

  const res = await discoverLead(db, {
    funnel,
    igUsername: username,
    profileUrl: `https://www.instagram.com/${username}/`,
    niche: note ?? null,
    bio: note ?? null,
    discoverySource: "manual",
    actorType: "unknown",
  });

  if (res.status === "created") {
    created++;
    await enqueue(db, { kind: "score_lead", payload: { leadId: res.leadId }, dedupeKey: `score:${res.leadId}` });
    console.log(`+ ${username}`);
  } else if (res.status === "duplicate") {
    dup++;
    console.log(`= ${username} (já existe)`);
  } else {
    blocked++;
    console.log(`x ${username} (${res.reason})`);
  }
}

console.log(`\n${created} novos, ${dup} duplicados, ${blocked} bloqueados. O worker (pnpm dev) vai processar.`);
process.exit(0);
