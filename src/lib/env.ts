import "@/lib/server-only-shim";
import { z } from "zod";

const timeRange = z
  .string()
  .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, "OPERATING_HOURS deve ser HH:MM-HH:MM");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  CLAUDEIA_API_KEY: z.string().min(1),
  CLAUDEIA_MODEL: z.string().min(1),
  CLAUDEIA_MODEL_FAST: z.string().min(1),
  CLAUDEIA_MONTHLY_BUDGET_USD: z.coerce.number().positive(),

  CHROME_CDP_URL: z.string().url(),
  CHROME_PROFILE_DIR: z.string().min(1),

  INSTAGRAM_APP_SECRET: z.string().min(1),
  INSTAGRAM_PAGE_ACCESS_TOKEN: z.string().min(1),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().min(1),

  DATABASE_URL: z.string().min(1).default("file:./data/app.db"),

  MAX_DMS_PER_DAY: z.coerce.number().int().positive().default(30),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(240),
  OPERATING_HOURS: timeRange.default("09:00-20:00"),
  OPERATING_TIMEZONE: z.string().min(1).default("America/Sao_Paulo"),

  BROWSER_SEND_MODE: z
    .enum(["simulation", "dry_run", "live"])
    .default("simulation"),

  // Optional: shared token for the lifecycle-signal ingest endpoint.
  INGEST_TOKEN: z.string().min(8).optional(),
});

export type Env = z.infer<typeof schema>;

/**
 * Validates process.env once. In test mode, missing integration secrets are
 * tolerated so unit tests can run without real credentials.
 */
let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;

  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;
  const source = isTest ? withTestDefaults(process.env) : process.env;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }

  if (parsed.data.MIN_SECONDS_BETWEEN_DMS > parsed.data.MAX_SECONDS_BETWEEN_DMS) {
    throw new Error(
      "MIN_SECONDS_BETWEEN_DMS não pode ser maior que MAX_SECONDS_BETWEEN_DMS",
    );
  }

  cached = parsed.data;
  return cached;
}

function withTestDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const stub = {
    CLAUDEIA_API_KEY: "test",
    CLAUDEIA_MODEL: "claude-sonnet-5",
    CLAUDEIA_MODEL_FAST: "claude-haiku-4-5-20251001",
    CLAUDEIA_MONTHLY_BUDGET_USD: "10",
    CHROME_CDP_URL: "http://127.0.0.1:9222",
    CHROME_PROFILE_DIR: "./.chrome-profile",
    INSTAGRAM_APP_SECRET: "test",
    INSTAGRAM_PAGE_ACCESS_TOKEN: "test",
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "test",
    INSTAGRAM_BUSINESS_ACCOUNT_ID: "test",
    DATABASE_URL: "file::memory:",
  };
  return { ...stub, ...env };
}

/** Test-only: clears the memoized env so a test can re-parse with new values. */
export function resetEnvCache(): void {
  cached = null;
}

export function parseOperatingHours(range: string): { start: number; end: number } {
  const [start, end] = range.split("-");
  return { start: toMinutes(start!), end: toMinutes(end!) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}
