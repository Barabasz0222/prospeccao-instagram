"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { pauseSystem, resumeSystem, isSystemPaused } from "@/features/settings/repo";
import { log } from "@/lib/logger";

export async function togglePauseAction(formData: FormData): Promise<void> {
  const db = getDb();
  const paused = await isSystemPaused(db);
  const reason = String(formData.get("reason") ?? "Pausa manual pelo operador");
  if (paused) {
    await resumeSystem(db);
    log.warn("system.resumed", { by: "operator" });
  } else {
    await pauseSystem(db, reason);
    log.warn("system.paused", { by: "operator", reason });
  }
  revalidatePath("/");
}
