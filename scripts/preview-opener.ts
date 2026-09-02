/**
 * Mostra a mensagem de abertura que seria gerada para um perfil, SEM enviar e
 * SEM gravar nada. Usa o modo atual (chave real = IA; offline = template).
 *
 *   pnpm preview-opener oralvita
 *   pnpm preview-opener asseconmaringa contabilidade
 */
import "./_env";
import { getBrowserDriver } from "@/integrations/browser";
import { generateOpener } from "@/features/conversations/engine";

const handle = (process.argv[2] ?? "").replace(/^@/, "");
const note = process.argv[3];
if (!handle) {
  console.error("uso: pnpm preview-opener <handle> [nicho]");
  process.exit(1);
}

const signals = await getBrowserDriver().enrichProfile(handle);
if (!signals) {
  console.error(`Não consegui ler @${handle} (privado, inexistente, ou Chrome/CDP fora do ar).`);
  process.exit(1);
}

console.log("\n── Perfil lido ──");
console.log(`nome:      ${signals.displayName ?? "?"}`);
console.log(`bio:       ${(signals.bio ?? "?").replace(/\n/g, " / ")}`);
console.log(`categoria: ${signals.category ?? "?"}`);
console.log(`seguidores:${signals.followerCount ?? "?"}`);

for (const variantId of ["opener_A", "opener_B"]) {
  const msg = await generateOpener({
    funnel: "customer",
    displayName: signals.displayName,
    igUsername: handle,
    bio: signals.bio,
    category: signals.category,
    location: signals.location,
    niche: note ?? signals.category ?? null,
    variantId,
  });
  console.log(`\n── ${variantId} ──\n${msg}`);
}
process.exit(0);
