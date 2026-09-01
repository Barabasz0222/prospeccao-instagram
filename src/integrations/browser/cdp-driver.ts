import "@/lib/server-only-shim";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { log } from "@/lib/logger";
import { randomBetween } from "@/lib/time";
import type {
  BrowserDriver,
  DiscoveredProfile,
  DiscoverQuery,
  SendDmEvidence,
  SendDmInput,
  SendDmResult,
} from "./types";

const IG_HOST = "instagram.com";
const EVIDENCE_DIR = "screenshots";

type Mode = "dry_run" | "live";

/**
 * Playwright-over-CDP driver. Connects to the operator's dedicated Chrome
 * profile, opens its OWN tab, never steals focus, and closes the tab in a
 * finally block. If the CDP endpoint is unreachable it does NOT spawn a new
 * Chrome — the caller must register browser_unavailable and pause the queue.
 */
export class CdpBrowserDriver implements BrowserDriver {
  constructor(
    private readonly cdpUrl: string,
    private readonly mode: Mode,
  ) {}

  private async connect(): Promise<Browser> {
    return chromium.connectOverCDP(this.cdpUrl, { timeout: 10_000 });
  }

  async healthCheck() {
    let browser: Browser | null = null;
    try {
      browser = await this.connect();
      const context = browser.contexts()[0];
      if (!context) return { ok: false, reason: "nenhum contexto no Chrome (CDP)" };
      const page = await context.newPage();
      try {
        await page.goto(`https://www.${IG_HOST}/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
        // Logged-out IG redirects to /accounts/login/
        const loggedOut = page.url().includes("/accounts/login");
        return loggedOut
          ? { ok: false, reason: "sessão do Instagram não está logada" }
          : { ok: true };
      } finally {
        await page.close().catch(() => {});
      }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  /**
   * Best-effort public discovery. Instagram's DOM changes often, so selectors
   * here are a starting point the operator tunes against the live site during
   * the dry-run phase. Read-only: navigates, reads handles, never interacts.
   */
  async discoverProfiles(query: DiscoverQuery): Promise<DiscoveredProfile[]> {
    let browser: Browser | null = null;
    let page: Page | null = null;
    try {
      browser = await this.connect();
      const context = browser.contexts()[0];
      if (!context) throw new Error("nenhum contexto logado no Chrome");
      page = await context.newPage();

      const url =
        query.kind === "hashtag"
          ? `https://www.${IG_HOST}/explore/tags/${encodeURIComponent(query.term.replace(/^#/, ""))}/`
          : `https://www.${IG_HOST}/explore/search/keyword/?q=${encodeURIComponent(query.term)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (page.url().includes("/accounts/login")) return [];

      const handles = await page.evaluate((max: number) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const a of Array.from(document.querySelectorAll('a[href^="/"]'))) {
          const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
          const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m && m[1] && !["explore", "reels", "p", "accounts"].includes(m[1]) && !seen.has(m[1])) {
            seen.add(m[1]);
            out.push(m[1]);
            if (out.length >= max) break;
          }
        }
        return out;
      }, query.limit);

      return handles.map((h) => ({ igUsername: h, profileUrl: `https://www.${IG_HOST}/${h}/` }));
    } catch (e) {
      log.warn("browser.discover_failed", { error: e instanceof Error ? e.message : String(e) });
      return [];
    } finally {
      await page?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  async sendDm(input: SendDmInput): Promise<SendDmResult> {
    let browser: Browser | null = null;
    let page: Page | null = null;
    const consoleErrors: string[] = [];
    const networkFailures: string[] = [];

    try {
      browser = await this.connect();
    } catch (e) {
      return {
        status: "failed",
        error: `browser_unavailable: ${e instanceof Error ? e.message : String(e)}`,
        evidence: {},
      };
    }

    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error("nenhum contexto logado no Chrome");

      page = await context.newPage();
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      page.on("requestfailed", (r) =>
        networkFailures.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "?"}`),
      );

      // Domain guard: abort anything that is not Instagram.
      await page.route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        if (host.endsWith(IG_HOST) || host.endsWith("cdninstagram.com") || host.endsWith("fbcdn.net")) {
          return route.continue();
        }
        return route.abort();
      });

      await page.goto(input.profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!new URL(page.url()).hostname.endsWith(IG_HOST)) {
        throw new Error(`URL fora do domínio do Instagram: ${page.url()}`);
      }
      if (page.url().includes("/accounts/login")) {
        return {
          status: "blocked",
          reason: "sessão do Instagram não está logada",
          evidence: await this.capture(page, input, consoleErrors, networkFailures),
        };
      }

      const msgButton = page.getByRole("button", { name: /message|mensagem|enviar mensagem/i }).first();
      await msgButton.waitFor({ state: "visible", timeout: 15_000 });
      await msgButton.click();

      const box = page.getByRole("textbox").first();
      await box.waitFor({ state: "visible", timeout: 15_000 });
      await box.click();

      // Human rhythm: per-character delay, then a pause before sending.
      await box.pressSequentially(input.message, { delay: input.typingDelayMs ?? randomBetween(40, 120) });
      await page.waitForTimeout(randomBetween(800, 2200));

      if (this.mode === "dry_run") {
        log.info("browser.dry_run.compose_ok", { leadId: input.leadId, jobId: input.jobId });
        return {
          status: "blocked",
          reason: "dry_run: envio final não executado",
          evidence: await this.capture(page, input, consoleErrors, networkFailures),
        };
      }

      await box.press("Enter");
      await page.waitForTimeout(randomBetween(600, 1500));

      return {
        status: "sent",
        evidence: { url: page.url(), consoleErrors, networkFailures },
      };
    } catch (e) {
      const evidence = page
        ? await this.capture(page, input, consoleErrors, networkFailures)
        : { consoleErrors, networkFailures };
      return { status: "failed", error: e instanceof Error ? e.message : String(e), evidence };
    } finally {
      await page?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  private async capture(
    page: Page,
    input: SendDmInput,
    consoleErrors: string[],
    networkFailures: string[],
  ): Promise<SendDmEvidence> {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${EVIDENCE_DIR}/job-${input.jobId}-${stamp}`;
    const screenshotPath = `${base}.png`;
    const accessibilitySnapshotPath = `${base}.a11y.json`;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const snapshot = await page.accessibility.snapshot();
      writeFileSync(join(process.cwd(), accessibilitySnapshotPath), JSON.stringify(snapshot, null, 2));
    } catch {
      /* evidence is best-effort */
    }
    return {
      url: page.url(),
      screenshotPath,
      accessibilitySnapshotPath,
      consoleErrors,
      networkFailures,
    };
  }
}
