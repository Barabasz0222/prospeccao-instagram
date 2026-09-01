/**
 * Processa a fila de jobs uma vez e sai. Útil para demonstração:
 *   pnpm tsx scripts/seed-demo.ts && pnpm tsx scripts/drain-once.ts
 */
import "./_env";
import { setBrowserDriver, FakeBrowserDriver } from "@/integrations/browser";
import { drainQueue, makeContext } from "@/worker/runner";

if ((process.env.BROWSER_SEND_MODE ?? "simulation") === "simulation") {
  setBrowserDriver(new FakeBrowserDriver());
}

const n = await drainQueue(makeContext("drain-once"));
console.log(`${n} jobs processados.`);
process.exit(0);
