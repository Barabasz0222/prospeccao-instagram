import "@/lib/server-only-shim";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tracks long-lived child processes (Chrome with CDP, the cloudflared
 * tunnel) started from the panel's "Sistema" page, so a button click can
 * start/stop/check them instead of the operator typing shell commands.
 * Kept on `globalThis` so it survives Next.js dev hot-reload.
 */
type Managed = {
  name: string;
  child: ChildProcess | null;
  startedAt: string | null;
  lastLines: string[];
  extra: Record<string, string>;
};

type Registry = Map<string, Managed>;

const KEY = "__brasztech_process_registry__";
function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

function getOrCreate(name: string): Managed {
  const r = registry();
  let m = r.get(name);
  if (!m) {
    m = { name, child: null, startedAt: null, lastLines: [], extra: {} };
    r.set(name, m);
  }
  return m;
}

function pushLine(m: Managed, line: string) {
  m.lastLines.push(line);
  if (m.lastLines.length > 200) m.lastLines.shift();
}

export function isRunning(name: string): boolean {
  const m = registry().get(name);
  return !!m?.child && m.child.exitCode === null && !m.child.killed;
}

export function status(name: string) {
  const m = getOrCreate(name);
  return {
    running: isRunning(name),
    startedAt: m.startedAt,
    lastLines: m.lastLines.slice(-40),
    extra: m.extra,
  };
}

export function stop(name: string): void {
  const m = registry().get(name);
  if (m?.child && !m.child.killed) {
    m.child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  }
  if (m) {
    m.child = null;
    m.startedAt = null;
  }
}

/**
 * Starts a process if one isn't already running under `name`. `onLine` is
 * called for each stdout/stderr line (merged), useful for scraping a URL out
 * of tool output (e.g. the cloudflared tunnel address).
 */
export function start(
  name: string,
  cmd: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string, m: ReturnType<typeof getOrCreate>) => void; shell?: boolean } = {},
): { started: boolean; reason?: string } {
  if (isRunning(name)) return { started: false, reason: "já está rodando" };
  const m = getOrCreate(name);
  m.lastLines = [];
  m.extra = {};

  let child: ChildProcess;
  try {
    child = spawn(cmd, args, {
      cwd: opts.cwd ?? process.cwd(),
      // No shell: these are direct .exe targets, and cmd.exe mangles quoted
      // paths with spaces (e.g. "C:\Program Files\...") when shell is true.
      shell: opts.shell ?? false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return { started: false, reason: e instanceof Error ? e.message : String(e) };
  }

  m.child = child;
  m.startedAt = new Date().toISOString();

  const onData = (buf: Buffer) => {
    for (const line of buf.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      pushLine(m, line);
      opts.onLine?.(line, m);
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", (code) => {
    pushLine(m, `[processo encerrado, código ${code}]`);
    if (m.child === child) {
      m.child = null;
      m.startedAt = null;
    }
  });

  return { started: true };
}

/** Best-effort Chrome executable path per OS. */
export function findChromePath(): string | null {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function chromeProfileDir(): string {
  return resolve(process.cwd(), ".chrome-profile");
}
