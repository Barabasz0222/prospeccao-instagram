import type { BrowserDriver, SendDmInput, SendDmResult } from "./types";

/**
 * In-memory browser driver for simulation mode and tests. Records every call
 * and returns a deterministic "sent" result unless told otherwise. No real
 * Chrome, no network — safe to run in any environment (container, CI).
 */
export class FakeBrowserDriver implements BrowserDriver {
  readonly sent: SendDmInput[] = [];
  healthy = true;
  nextResult: SendDmResult | null = null;

  async healthCheck() {
    return this.healthy
      ? { ok: true }
      : { ok: false, reason: "fake driver marcado como indisponível" };
  }

  async sendDm(input: SendDmInput): Promise<SendDmResult> {
    this.sent.push(input);
    if (this.nextResult) {
      const r = this.nextResult;
      this.nextResult = null;
      return r;
    }
    return {
      status: "sent",
      evidence: { url: `${input.profileUrl}` },
    };
  }
}
