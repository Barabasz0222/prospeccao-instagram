/**
 * Teste real do navegador — SÓ rode na sua máquina, com o Chrome dedicado
 * aberto e logado no Instagram (ver SETUP.md).
 *
 * Nível 2 (dry_run): abre o perfil, compõe a mensagem, NÃO envia.
 * Nível 3 (live):     envia UMA DM de verdade. Exige autorização explícita.
 *
 *   BROWSER_SEND_MODE=dry_run pnpm tsx scripts/browser-smoke.ts <@perfil> "<mensagem>"
 *   SMOKE_CONFIRM=eu-autorizo BROWSER_SEND_MODE=live pnpm tsx scripts/browser-smoke.ts <@perfil> "<mensagem>"
 */
import "./_env";
import { CdpBrowserDriver } from "@/integrations/browser/cdp-driver";
import { assertOutboundText } from "@/lib/claims";
import { loadEnv } from "@/lib/env";

const [, , handleArg, messageArg] = process.argv;
if (!handleArg || !messageArg) {
  console.error('uso: browser-smoke.ts <@perfil> "<mensagem>"');
  process.exit(2);
}
const username = handleArg.replace(/^@/, "");
const message = messageArg;

const env = loadEnv();
if (env.BROWSER_SEND_MODE === "simulation") {
  console.error("Defina BROWSER_SEND_MODE=dry_run ou live para o smoke test real.");
  process.exit(2);
}
if (env.BROWSER_SEND_MODE === "live" && process.env.SMOKE_CONFIRM !== "eu-autorizo") {
  console.error('Modo live exige: SMOKE_CONFIRM=eu-autorizo');
  process.exit(2);
}

assertOutboundText(message); // regra de afirmações verificadas

const driver = new CdpBrowserDriver(env.CHROME_CDP_URL, env.BROWSER_SEND_MODE);

const health = await driver.healthCheck();
console.log("healthCheck:", health);
if (!health.ok) process.exit(1);

const result = await driver.sendDm({
  jobId: 0,
  leadId: 0,
  profileUrl: `https://www.instagram.com/${username}/`,
  igUsername: username,
  message,
});
console.log("resultado:", JSON.stringify(result, null, 2));
process.exit(result.status === "failed" ? 1 : 0);
