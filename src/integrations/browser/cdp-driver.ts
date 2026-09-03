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
  ProfileSignals,
  SendDmEvidence,
  SendDmInput,
  SendDmResult,
} from "./types";

const RESERVED = new Set([
  "explore", "reels", "reel", "p", "accounts", "direct", "stories", "about",
  "legal", "privacy", "terms", "developer", "api", "web", "graphql", "ajax",
  "emails", "session", "challenge", "oauth", "http", "https",
]);

/**
 * "6.036" / "6,036" / "12,3 mil" / "1.2M" / "638" → integer.
 * Without a k/m/mil suffix the value is a plain integer, so every "." and ","
 * is a thousands separator (this was the "6.036 → 6" bug). With a suffix, only
 * the last separator is the decimal point.
 */
function expandCount(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, " ");
  const m = t.match(/^([\d.,]+)\s*(mil|mi|k|m|b)?$/);
  if (!m) return null;
  const suf = m[2] ?? "";
  let n: number;
  if (suf) {
    const dec = m[1]!.replace(/[.,](?=.*[.,])/g, "").replace(",", ".");
    n = parseFloat(dec);
    if (suf === "mil" || suf === "k") n *= 1_000;
    else if (suf === "mi" || suf === "m") n *= 1_000_000;
    else if (suf === "b") n *= 1_000_000_000;
  } else {
    n = parseInt(m[1]!.replace(/[.,]/g, ""), 10);
  }
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** @internal test hook */
export const __expandCountForTest = expandCount;

const BUTTON_LINES =
  /^(seguir|following|seguindo|mensagem|message|enviar mensagem|send message|contato|contact|inscrever|subscribe|mais|more|ver mais|\.{2,}|editar perfil|edit profile|promover|promote|e-mail|email|ligar|call)$/i;
const COUNT_LINE = /(seguidor|seguindo|publica|post|follower|following)/i;
// Mutual-follow hint, highlight-reel names, and "e mais N" link counters that
// Instagram renders inside the header block.
const HEADER_JUNK = /^(seguido\(a\) por|seguido por|followed by|e mais \d)/i;
// A line that is only emoji / punctuation carries no signal.
const NOISE_LINE = /^[\p{P}\p{S}\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u;

/**
 * og: meta tags are the reliable source for the VIEWED profile's name and
 * counts (the embedded JSON is the logged-in viewer's). Bio + category come
 * from the rendered header text.
 */
function parseProfile(handle: string, html: string, headerText: string): ProfileSignals {
  const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] ?? "";
  const ogDesc = html.match(/<meta property="og:description" content="([^"]*)"/i)?.[1] ?? "";

  const displayName = ogTitle.match(/^(.*?)\s*\(@/)?.[1]?.trim() || null;

  const grab = (re: RegExp) => {
    const m = ogDesc.match(re);
    return m ? expandCount(m[1]!) : null;
  };
  const followerCount =
    grab(/([\d.,]+\s*(?:mil|mi|k|m)?)\s*seguidor/i) ?? grab(/([\d.,]+\s*[KMB]?)\s*Followers/i);
  const followingCount =
    grab(/seguindo\s*([\d.,]+\s*(?:mil|mi|k|m)?)/i) ?? grab(/([\d.,]+\s*[KMB]?)\s*Following/i);
  const postCount =
    grab(/([\d.,]+\s*(?:mil|mi|k|m)?)\s*(?:publica|posts?)/i) ?? grab(/([\d.,]+\s*[KMB]?)\s*Posts/i);

  // Header text lines minus the handle, buttons, counts and the display name.
  // Everything from the first "Seguido(a) por..." onward is highlight-reel
  // names and link counters — drop that tail.
  const junk = new Set<string>([handle.toLowerCase(), (displayName ?? "").toLowerCase()]);
  const rawLines = headerText.split("\n").map((l) => l.trim());
  const cut = rawLines.findIndex((l) => HEADER_JUNK.test(l));
  const lines = (cut >= 0 ? rawLines.slice(0, cut) : rawLines).filter(
    (l) =>
      l &&
      !junk.has(l.toLowerCase()) &&
      !BUTTON_LINES.test(l) &&
      !COUNT_LINE.test(l) &&
      !NOISE_LINE.test(l) &&
      !/^\d[\d.,]*\s*(mil|mi|k|m)?$/i.test(l),
  );
  // First short line is usually the business category; the rest is the bio.
  let category: string | null = null;
  let bioLines = lines;
  if (
    lines.length > 1 &&
    lines[0]!.length <= 40 &&
    !/https?:|www\.|🔗|linktr|@/.test(lines[0]!) &&
    lines[0]!.toLowerCase() !== (displayName ?? "").toLowerCase()
  ) {
    category = lines[0]!;
    bioLines = lines.slice(1);
  }
  const bio = bioLines.filter((l) => !/^https?:\/\/|^www\./i.test(l)).join("\n").trim() || null;
  const externalUrl = bioLines.find((l) => /^https?:\/\/|^www\./i.test(l)) ?? null;
  const bioHashtags = Array.from((bio ?? "").matchAll(/#([\p{L}0-9_]+)/gu)).map((m) => m[1]!);

  return {
    igUsername: handle,
    profileUrl: `https://www.instagram.com/${handle}/`,
    displayName,
    bio,
    category,
    location: null,
    followerCount,
    followingCount,
    postCount,
    externalUrl,
    isPrivate: /esta conta é privada|this account is private/i.test(headerText),
    isVerified: /verificad|verified/i.test(ogTitle),
    bioHashtags,
  };
}

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
  private readonly debugDump = process.env.BROWSER_ENRICH_DUMP !== "0";

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
   * Public discovery from the logged-in session. Read-only: navigates and
   * reads the rendered DOM, never interacts, never touches a private endpoint.
   * Instagram's markup shifts, so the operator tunes the selectors against the
   * live site in the dry-run phase (evidence lands in screenshots/).
   */
  async discoverProfiles(query: DiscoverQuery): Promise<DiscoveredProfile[]> {
    let browser: Browser | null = null;
    let page: Page | null = null;
    try {
      browser = await this.connect();
      const context = browser.contexts()[0];
      if (!context) throw new Error("nenhum contexto logado no Chrome");
      page = await context.newPage();

      let handles: string[] = [];
      if (query.kind === "hashtag") {
        handles = await this.fromHashtag(page, query.term.replace(/^#/, ""), query.limit);
      } else if (query.kind === "keyword") {
        handles = await this.fromSearch(page, query.term, query.limit);
      } else {
        handles = await this.fromRelated(page, query.term.replace(/^@/, ""), query.limit);
      }

      const clean = handles
        .map((h) => h.toLowerCase().replace(/[^a-z0-9._]/g, ""))
        .filter((h) => h.length > 1 && h.length <= 30 && !RESERVED.has(h));
      const unique = Array.from(new Set(clean)).slice(0, query.limit);

      return unique.map((h) => ({ igUsername: h, profileUrl: `https://www.${IG_HOST}/${h}/` }));
    } catch (e) {
      log.warn("browser.discover_failed", { term: query.term, error: e instanceof Error ? e.message : String(e) });
      await this.captureDiscover(page, query).catch(() => {});
      return [];
    } finally {
      await page?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  /** Hashtag page -> recent post permalinks -> post author handles. */
  private async fromHashtag(page: Page, tag: string, limit: number): Promise<string[]> {
    await page.goto(`https://www.${IG_HOST}/explore/tags/${encodeURIComponent(tag)}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (page.url().includes("/accounts/login")) return [];
    await this.scroll(page, 4);

    const postLinks: string[] = await page.evaluate((max: number) => {
      const out = new Set<string>();
      for (const a of Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'))) {
        const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
        const m = href.match(/\/(p|reel)\/[^/]+\//);
        if (m) out.add(m[0]);
        if (out.size >= max * 3) break;
      }
      return Array.from(out);
    }, limit);

    const authors: string[] = [];
    for (const link of postLinks.slice(0, limit * 3)) {
      if (authors.length >= limit) break;
      try {
        await page.goto(`https://www.${IG_HOST}${link}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(randomBetween(400, 1200));
        const author = await page.evaluate(() => {
          const a = document.querySelector('article a[href^="/"]:not([href*="/p/"]):not([href*="/reel/"])');
          const href = a?.getAttribute("href") ?? "";
          const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
          return m?.[1] ?? null;
        });
        if (author) authors.push(author);
      } catch {
        /* skip a post that won't load */
      }
    }
    return authors;
  }

  /** Search box -> account results. */
  private async fromSearch(page: Page, term: string, limit: number): Promise<string[]> {
    await page.goto(`https://www.${IG_HOST}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (page.url().includes("/accounts/login")) return [];
    const searchBtn = page.getByRole("link", { name: /search|pesquisa|busca/i }).first();
    await searchBtn.click({ timeout: 10_000 }).catch(() => {});
    const box = page.getByRole("textbox").first();
    await box.waitFor({ state: "visible", timeout: 10_000 });
    await box.pressSequentially(term, { delay: randomBetween(40, 110) });
    await page.waitForTimeout(randomBetween(1500, 3000));

    return page.evaluate((max: number) => {
      const out: string[] = [];
      for (const a of Array.from(document.querySelectorAll('a[href^="/"][role="link"], a[href^="/"]'))) {
        const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
        const m = href.match(/^\/([A-Za-z0-9._]+)\/$/);
        if (m && m[1]) out.push(m[1]);
        if (out.length >= max * 2) break;
      }
      return out;
    }, limit);
  }

  /** Seed profile -> "similar accounts" chips. */
  private async fromRelated(page: Page, seed: string, limit: number): Promise<string[]> {
    await page.goto(`https://www.${IG_HOST}/${encodeURIComponent(seed)}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (page.url().includes("/accounts/login")) return [];
    await page.waitForTimeout(randomBetween(1000, 2500));
    return page.evaluate((max: number) => {
      const out: string[] = [];
      for (const a of Array.from(document.querySelectorAll('a[href^="/"]'))) {
        const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
        const m = href.match(/^\/([A-Za-z0-9._]+)\/$/);
        if (m && m[1]) out.push(m[1]);
        if (out.length >= max * 3) break;
      }
      return out;
    }, limit);
  }

  async enrichProfile(igUsername: string): Promise<ProfileSignals | null> {
    let browser: Browser | null = null;
    let page: Page | null = null;
    const handle = igUsername.toLowerCase().replace(/^@/, "");
    try {
      browser = await this.connect();
      const context = browser.contexts()[0];
      if (!context) throw new Error("nenhum contexto logado no Chrome");
      page = await context.newPage();
      await page.goto(`https://www.${IG_HOST}/${encodeURIComponent(handle)}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (page.url().includes("/accounts/login")) return null;
      if (page.url().includes("/accounts/") || (await page.title()).toLowerCase().includes("page not found")) {
        return null;
      }
      // og: meta tags are the only server-rendered data ABOUT THE VIEWED
      // profile (the embedded JSON is the logged-in viewer's). Bio/category
      // only exist after the client renders the header.
      const html = await page.content();
      await page.waitForTimeout(randomBetween(2200, 3800));
      const headerText = await page
        .evaluate(() => {
          const el = document.querySelector("header") || document.querySelector("main");
          return el ? (el as HTMLElement).innerText || "" : "";
        })
        .catch(() => "");

      const signals = parseProfile(handle, html, headerText);

      if (this.debugDump) {
        mkdirSync(EVIDENCE_DIR, { recursive: true });
        writeFileSync(join(process.cwd(), `${EVIDENCE_DIR}/enrich-${handle}.html`), html);
        writeFileSync(join(process.cwd(), `${EVIDENCE_DIR}/enrich-${handle}.header.txt`), headerText);
        log.info("browser.enrich_debug", {
          handle,
          displayName: signals.displayName,
          bio: (signals.bio ?? "").slice(0, 140),
          category: signals.category,
          followerCount: signals.followerCount,
          isPrivate: signals.isPrivate,
          ogDesc: (html.match(/<meta property="og:description" content="([^"]*)"/i)?.[1] ?? "").slice(0, 120),
        });
      }

      return signals;
    } catch (e) {
      log.warn("browser.enrich_failed", { handle, error: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      await page?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  private async scroll(page: Page, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel(0, 2400).catch(() => {});
      await page.waitForTimeout(randomBetween(700, 1600));
    }
  }

  private async captureDiscover(page: Page | null, query: DiscoverQuery): Promise<void> {
    if (!page) return;
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${EVIDENCE_DIR}/discover-${query.kind}-${query.term.slice(0, 20)}-${stamp}.png` });
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

      await page.waitForTimeout(randomBetween(1500, 3000));

      // The profile's message action button. Try the exact-name button first,
      // then a clickable element whose whole text is just "Mensagem"/"Message",
      // scoped to the main column so we never hit a bio link or the left nav.
      const main = page.locator("main");
      const msgButton = main
        .getByRole("button", { name: "Mensagem", exact: true })
        .or(main.getByRole("button", { name: "Message", exact: true }))
        .or(main.locator('div[role="button"]', { hasText: /^(Mensagem|Message)$/ }))
        .or(main.locator('div[role="button"]:has(> div:text-is("Mensagem"))'))
        .first();
      try {
        await msgButton.waitFor({ state: "visible", timeout: 12_000 });
      } catch {
        return {
          status: "blocked",
          reason: "perfil sem botão de mensagem (não aceita solicitação, ou seletor mudou)",
          evidence: await this.capture(page, input, consoleErrors, networkFailures),
        };
      }
      await msgButton.scrollIntoViewIfNeeded().catch(() => {});
      await msgButton.click();
      await page.waitForTimeout(randomBetween(1800, 3200));

      // The DM composer is a contenteditable textbox. Fall back to any textbox
      // that is NOT the search field.
      const box = page
        .locator('div[contenteditable="true"][role="textbox"]')
        .or(page.getByRole("textbox", { name: /mensagem|message/i }))
        .or(page.locator('textarea[placeholder*="ensagem" i], textarea[placeholder*="essage" i]'))
        .first();
      try {
        await box.waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        // A dialog opened but it is not the composer (e.g. the "Links" modal).
        await page.keyboard.press("Escape").catch(() => {});
        return {
          status: "blocked",
          reason: "caixa de mensagem não abriu (abriu outra tela)",
          evidence: await this.capture(page, input, consoleErrors, networkFailures),
        };
      }
      await box.click();

      // Human rhythm: per-character delay, then a pause before sending.
      // Generous timeout so a longer opener does not trip on the default 30s.
      await box.pressSequentially(input.message, {
        delay: input.typingDelayMs ?? randomBetween(35, 90),
        timeout: 90_000,
      });
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
