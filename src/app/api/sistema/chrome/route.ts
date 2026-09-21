import { NextResponse } from "next/server";
import {
  chromeProfileDir,
  findChromePath,
  start,
  status,
  stop,
} from "@/lib/process-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME = "chrome";

async function cdpReachable(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:9222/json/version", { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const s = status(NAME);
  const reachable = await cdpReachable();
  return NextResponse.json({ ...s, cdpReachable: reachable });
}

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  if (action === "stop") {
    stop(NAME);
    return NextResponse.json({ ok: true });
  }

  if (await cdpReachable()) {
    return NextResponse.json({ ok: true, note: "Chrome já está aberto com depuração ativa." });
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    return NextResponse.json(
      { ok: false, error: "Não encontrei o Google Chrome instalado. Instale em google.com/chrome." },
      { status: 400 },
    );
  }

  const res = start(NAME, chromePath, [
    "--remote-debugging-port=9222",
    `--user-data-dir=${chromeProfileDir()}`,
  ]);
  if (!res.started) return NextResponse.json({ ok: false, error: res.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
