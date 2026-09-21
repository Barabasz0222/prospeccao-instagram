import { NextResponse } from "next/server";
import { z } from "zod";
import { readBusinessRaw, writeBusinessFromWizard } from "@/lib/business-file";
import { readWizardEnv, writeWizardEnv, WIZARD_ENV_KEYS } from "@/lib/env-file";
import { resetBusinessCache } from "@/lib/business";
import { resetEnvCache } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ business: readBusinessRaw(), env: readWizardEnv() });
}

const bodySchema = z.object({
  business: z
    .object({
      ownerName: z.string(),
      ownerRole: z.string(),
      companyName: z.string(),
      website: z.string(),
      instagramHandle: z.string(),
      whatsappNumber: z.string(),
      affiliateGroup: z.string(),
      oneLinePitch: z.string(),
      howItWorks: z.string(),
      revenueModel: z.string(),
      verifiedClaims: z.string(),
      unverifiedClaims: z.string(),
      segments: z.string(),
      keywords: z.string(),
      affiliateTopics: z.string(),
      country: z.string(),
      region: z.string(),
    })
    .optional(),
  env: z.record(z.string()).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }

  try {
    if (parsed.data.business) {
      writeBusinessFromWizard(parsed.data.business);
      resetBusinessCache();
    }
    if (parsed.data.env) {
      const allowed = Object.fromEntries(
        Object.entries(parsed.data.env).filter(([k]) => (WIZARD_ENV_KEYS as readonly string[]).includes(k)),
      );
      writeWizardEnv(allowed);
      // Live-patch this process so a "Testar" click right after saving sees
      // the new value — the worker process still needs a restart to pick it up.
      for (const [k, v] of Object.entries(allowed)) process.env[k] = v;
      resetEnvCache();
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
