/** Structured logger. Never logs tokens, secrets, or full credentials. */
type Level = "debug" | "info" | "warn" | "error";

const REDACT = /(api[_-]?key|secret|token|authorization|password)/i;

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = REDACT.test(k) ? "[redacted]" : v;
  }
  return out;
}

function emit(level: Level, msg: string, meta: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...redact(meta),
  });
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
};
