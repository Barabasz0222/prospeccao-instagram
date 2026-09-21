import { NextResponse } from "next/server";
import { loadEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs the same handshake Meta performs when the operator saves the webhook
 * URL in the dashboard — lets the panel confirm it will pass *before* the
 * operator pastes the URL into the Meta site.
 */
export async function GET(req: Request) {
  const tunnelUrl = new URL(req.url).searchParams.get("url");
  if (!tunnelUrl) return NextResponse.json({ ok: false, error: "informe a URL do túnel" }, { status: 400 });

  let verifyToken: string;
  try {
    verifyToken = loadEnv().INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (!verifyToken) {
    return NextResponse.json({ ok: false, error: "INSTAGRAM_WEBHOOK_VERIFY_TOKEN não configurado" }, { status: 400 });
  }

  const challenge = String(Math.floor(Math.random() * 1_000_000));
  const target = new URL("/api/webhooks/instagram", tunnelUrl);
  target.searchParams.set("hub.mode", "subscribe");
  target.searchParams.set("hub.verify_token", verifyToken);
  target.searchParams.set("hub.challenge", challenge);

  try {
    const res = await fetch(target.toString(), { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    if (res.ok && text === challenge) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({
      ok: false,
      error: `resposta inesperada (status ${res.status}): ${text.slice(0, 200)}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
