/**
 * Diagnostica um dump de enrich (screenshots/enrich-<handle>.html):
 * o que dá pra extrair, quantas ocorrências de cada campo, o que há perto.
 *
 *   pnpm tsx scripts/inspect-enrich.ts nextflowx
 */
import { readFileSync } from "node:fs";

const handle = (process.argv[2] ?? "").replace(/^@/, "").toLowerCase();
if (!handle) {
  console.error("uso: pnpm tsx scripts/inspect-enrich.ts <handle>");
  process.exit(1);
}
const path = `screenshots/enrich-${handle}.html`;
const html = readFileSync(path, "utf8");
console.log(`arquivo: ${path}  (${(html.length / 1024).toFixed(0)} KB)\n`);

const count = (re: RegExp) => (html.match(re) ?? []).length;

console.log("=== meta tags ===");
for (const p of ["og:title", "og:description", "description", "al:ios:url"]) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]+content="([^"]*)"`, "i"));
  console.log(`${p}: ${m ? m[1] : "(ausente)"}`);
}

console.log("\n=== ocorrências ===");
console.log(`"username":"${handle}"       ${count(new RegExp(`"username":"${handle}"`, "gi"))}`);
console.log(`"username":                   ${count(/"username":/g)}`);
console.log(`"biography":                  ${count(/"biography":/g)}`);
console.log(`"full_name":                  ${count(/"full_name":/g)}`);
console.log(`"edge_followed_by":           ${count(/"edge_followed_by":/g)}`);
console.log(`"follower_count":             ${count(/"follower_count":/g)}`);
console.log(`"category_name":              ${count(/"category_name":/g)}`);
console.log(`"is_private":                 ${count(/"is_private":/g)}`);

console.log("\n=== primeiras 3 janelas ao redor de \"username\": ===");
let idx = 0;
let found = 0;
while (found < 3) {
  const at = html.indexOf('"username":', idx);
  if (at < 0) break;
  found++;
  idx = at + 12;
  console.log(`\n--- #${found} @ ${at} ---`);
  console.log(html.slice(at, at + 400).replace(/\s+/g, " "));
}

console.log("\n=== janela ao redor de \"biography\": (1ª) ===");
const b = html.indexOf('"biography":');
if (b >= 0) console.log(html.slice(Math.max(0, b - 200), b + 400).replace(/\s+/g, " "));
else console.log("(nenhuma)");
