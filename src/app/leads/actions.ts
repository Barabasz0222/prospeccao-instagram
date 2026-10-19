"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { events, exceptions, leads } from "@/db/schema";
import { advancePipeline, moveChannel } from "@/features/conversations/repo";
import { applyCustomerSignal } from "@/features/leads/lifecycle";
import { setSetting } from "@/features/settings/repo";
import { log } from "@/lib/logger";

export async function advanceLeadStageAction(formData: FormData): Promise<void> {
  const leadId = Number(formData.get("leadId"));
  const to = String(formData.get("to"));
  const db = getDb();
  await advancePipeline(db, leadId, to);
  log.info("panel.advance_stage", { leadId, to });
  revalidatePath(`/leads/${leadId}`);
}

/**
 * The operator DM'd this lead by hand, outside the AI. Takes the lead out of
 * the dispatcher's queue (pipeline -> contacted) and parks the channel waiting
 * for a reply so an inbound answer still hands off to the API normally. No
 * follow-up is scheduled for manual contacts.
 */
export async function markManuallyContactedAction(formData: FormData): Promise<void> {
  const leadId = Number(formData.get("leadId"));
  const db = getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;

  await advancePipeline(db, leadId, "contacted");
  if (lead.channelState === "browser_contact_pending") {
    await moveChannel(db, leadId, "browser_contact_sent");
    await moveChannel(db, leadId, "waiting_inbound_reply");
  }
  await db.insert(events).values({ leadId, type: "manual_contact", data: {} });
  log.info("panel.manual_contact", { leadId });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function markDoNotContactAction(formData: FormData): Promise<void> {
  const leadId = Number(formData.get("leadId"));
  const db = getDb();
  await moveChannel(db, leadId, "do_not_contact");
  await advancePipeline(db, leadId, "closed").catch(() => {});
  log.warn("panel.do_not_contact", { leadId });
  revalidatePath(`/leads/${leadId}`);
}

export async function applySignalAction(formData: FormData): Promise<void> {
  const leadId = Number(formData.get("leadId"));
  const type = String(formData.get("type")) as Parameters<typeof applyCustomerSignal>[1]["type"];
  await applyCustomerSignal(getDb(), { type, leadId });
  revalidatePath(`/leads/${leadId}`);
}

export async function resolveExceptionAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  await getDb().update(exceptions).set({ status: "resolved" }).where(eq(exceptions.id, id));
  revalidatePath("/excecoes");
}

export async function updateSettingAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key"));
  const raw = String(formData.get("value"));
  const num = Number(raw);
  await setSetting(getDb(), key, Number.isFinite(num) && raw.trim() !== "" ? num : raw, "operator");
  revalidatePath("/configuracoes");
}

export async function toggleFollowupAction(formData: FormData): Promise<void> {
  const enabled = String(formData.get("enabled")) === "true";
  await setSetting(getDb(), "followup.enabled", enabled, "operator");
  revalidatePath("/configuracoes");
}
