/**
 * Abre um perfil no Chrome dedicado e lista todos os botões / elementos
 * clicáveis com o texto, pra achar o seletor certo do botão "Mensagem".
 * Não clica em nada, não envia nada.
 *
 *   pnpm tsx scripts/inspect-dm.ts clinicaflorian
 */
import "./_env";
import { chromium } from "playwright";
import { loadEnv } from "@/lib/env";

const handle = (process.argv[2] ?? "").replace(/^@/, "");
if (!handle) {
  console.error("uso: pnpm tsx scripts/inspect-dm.ts <handle>");
  process.exit(1);
}

const env = loadEnv();
const browser = await chromium.connectOverCDP(env.CHROME_CDP_URL, { timeout: 10_000 });
const ctx = browser.contexts()[0]!;
const page = await ctx.newPage();

await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(4000);

const dump = await page.evaluate(() => {
  const out: { tag: string; role: string | null; text: string; aria: string | null }[] = [];
  const sel = 'button, [role="button"], a[role="button"], div[tabindex="0"]';
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const text = (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 60) ?? "";
    const aria = el.getAttribute("aria-label");
    if (!text && !aria) continue;
    out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), text, aria });
  }
  return out;
});

console.log(`\n=== clicáveis em @${handle} ===`);
for (const d of dump) {
  console.log(`[${d.tag}${d.role ? ` role=${d.role}` : ""}] "${d.text}"${d.aria ? `  aria="${d.aria}"` : ""}`);
}

// header innerText helps too
const header = await page.evaluate(() => {
  const h = document.querySelector("header") || document.querySelector("main section");
  return h ? (h as HTMLElement).innerText.slice(0, 500) : "(sem header)";
});
console.log("\n=== texto do topo do perfil ===\n" + header);

await page.screenshot({ path: `screenshots/inspect-dm-${handle}.png` });
console.log(`\nscreenshot: screenshots/inspect-dm-${handle}.png`);
await page.close();
await browser.close();
process.exit(0);
