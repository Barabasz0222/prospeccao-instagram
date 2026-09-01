import { and, eq, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { doNotContact, leads, type NewLead } from "@/db/schema";
import * as schema from "@/db/schema";

type Db = LibSQLDatabase<typeof schema>;

export type DiscoverInput = Omit<
  NewLead,
  "id" | "createdAt" | "updatedAt" | "pipelineStage" | "channelState"
> & { igUsername: string };

export type DiscoverResult =
  | { status: "created"; leadId: number }
  | { status: "duplicate"; leadId: number }
  | { status: "blocked"; reason: string };

/**
 * Idempotent discovery: never creates a second lead for the same
 * (igUsername, funnel) or the same igUserId, and refuses anyone on the
 * do-not-contact list.
 */
export async function discoverLead(
  db: Db,
  input: DiscoverInput,
): Promise<DiscoverResult> {
  const username = input.igUsername.trim().toLowerCase().replace(/^@/, "");

  const dnc = await db
    .select()
    .from(doNotContact)
    .where(
      or(
        eq(doNotContact.igUsername, username),
        input.igUserId ? eq(doNotContact.metaUserId, input.igUserId) : undefined,
      ),
    )
    .limit(1);
  if (dnc.length > 0) {
    return { status: "blocked", reason: dnc[0]!.reason };
  }

  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      or(
        and(eq(leads.igUsername, username), eq(leads.funnel, input.funnel)),
        input.igUserId ? eq(leads.igUserId, input.igUserId) : undefined,
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { status: "duplicate", leadId: existing[0]!.id };
  }

  try {
    const [row] = await db
      .insert(leads)
      .values({ ...input, igUsername: username })
      .returning({ id: leads.id });
    return { status: "created", leadId: row!.id };
  } catch (err) {
    // Unique-constraint race: fall back to the row that won.
    const again = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.igUsername, username), eq(leads.funnel, input.funnel)))
      .limit(1);
    if (again.length > 0) return { status: "duplicate", leadId: again[0]!.id };
    throw err;
  }
}

export async function addToDoNotContact(
  db: Db,
  args: { igUsername?: string; metaUserId?: string; reason: string },
): Promise<void> {
  await db
    .insert(doNotContact)
    .values({
      igUsername: args.igUsername?.toLowerCase().replace(/^@/, ""),
      metaUserId: args.metaUserId,
      reason: args.reason,
    })
    .onConflictDoNothing();
}
