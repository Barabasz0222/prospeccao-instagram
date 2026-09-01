import { loadEnv } from "@/lib/env";
import { CdpBrowserDriver } from "./cdp-driver";
import { FakeBrowserDriver } from "./fake-driver";
import type { BrowserDriver } from "./types";

let singleton: BrowserDriver | null = null;

/** Chooses the driver from BROWSER_SEND_MODE. simulation -> fake; else -> CDP. */
export function getBrowserDriver(): BrowserDriver {
  if (singleton) return singleton;
  const env = loadEnv();
  singleton =
    env.BROWSER_SEND_MODE === "simulation"
      ? new FakeBrowserDriver()
      : new CdpBrowserDriver(env.CHROME_CDP_URL, env.BROWSER_SEND_MODE);
  return singleton;
}

/** Test hook. */
export function setBrowserDriver(driver: BrowserDriver | null): void {
  singleton = driver;
}

export * from "./types";
export { FakeBrowserDriver } from "./fake-driver";
