import "@/lib/server-only-shim";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env");
const EXAMPLE_PATH = resolve(process.cwd(), ".env.example");

/** Only these keys can be written by the setup wizard — never arbitrary ones. */
export const WIZARD_ENV_KEYS = [
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_PAGE_ACCESS_TOKEN",
  "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
  "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  "CLAUDEIA_API_KEY",
] as const;
export type WizardEnvKey = (typeof WIZARD_ENV_KEYS)[number];

function ensureEnvFile(): void {
  if (!existsSync(ENV_PATH)) copyFileSync(EXAMPLE_PATH, ENV_PATH);
}

/** Reads the current values of the wizard-editable keys, masking secrets. */
export function readWizardEnv(): Record<WizardEnvKey, string> {
  ensureEnvFile();
  const lines = readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  const out = {} as Record<WizardEnvKey, string>;
  for (const key of WIZARD_ENV_KEYS) {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    out[key] = line ? line.slice(key.length + 1) : "";
  }
  return out;
}

/** Updates the given keys in `.env` in place, preserving everything else. */
export function writeWizardEnv(updates: Partial<Record<WizardEnvKey, string>>): void {
  ensureEnvFile();
  const lines = readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
}
