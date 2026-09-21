import { NextResponse } from "next/server";
import { start, status, stop } from "@/lib/process-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME = "tunnel";
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export async function GET() {
  return NextResponse.json(status(NAME));
}

export async function POST(req: Request) {
  const { action, port } = (await req.json().catch(() => ({}))) as { action?: string; port?: number };

  if (action === "stop") {
    stop(NAME);
    return NextResponse.json({ ok: true });
  }

  const res = start(NAME, "cloudflared", ["tunnel", "--url", `http://localhost:${port ?? 3000}`], {
    onLine: (line, m) => {
      const found = line.match(URL_RE);
      if (found) m.extra.url = found[0];
    },
  });
  if (!res.started) {
    return NextResponse.json(
      {
        ok: false,
        error:
          res.reason === "já está rodando"
            ? res.reason
            : "Não consegui iniciar o cloudflared. Confirme que está instalado (winget install cloudflare.cloudflared).",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
