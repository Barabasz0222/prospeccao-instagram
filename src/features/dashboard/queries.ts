import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  aiCalls,
  decisionsLog,
  events,
  exceptions,
  jobs,
  leads,
} from "@/db/schema";

export type DashboardSummary = {
  leadsByStage: Record<string, number>;
  leadsByChannel: Record<string, number>;
  openExceptions: number;
  pendingJobs: number;
  deadJobs: number;
  aiSpendUsd: number;
  costPerLeadUsd: number | null;
  costPerActiveCustomerUsd: number | null;
  repliesLast7d: number;
  jobsByKind: { kind: string; status: string; n: number }[];
  recentDecisions: { at: string; leadId: number | null; decision: string; rationale: string | null }[];
};

function tally(rows: { k: string | null; n: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.k) out[r.k] = r.n;
  return out;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const db = getDb();

  const byStage = await db
    .select({ k: leads.pipelineStage, n: sql<number>`count(*)` })
    .from(leads)
    .groupBy(leads.pipelineStage);

  const byChannel = await db
    .select({ k: leads.channelState, n: sql<number>`count(*)` })
    .from(leads)
    .groupBy(leads.channelState);

  const [{ n: openExc } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(exceptions)
    .where(sql`${exceptions.status} = 'open'`);

  const [{ n: pending } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(jobs)
    .where(sql`${jobs.status} = 'pending'`);

  const [{ n: dead } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(jobs)
    .where(sql`${jobs.status} = 'dead'`);

  const [{ spend } = { spend: 0 }] = await db
    .select({ spend: sql<number>`coalesce(sum(${aiCalls.estimatedCostUsd}), 0)` })
    .from(aiCalls);

  const [{ n: totalLeads } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(leads);

  const [{ n: activeCustomers } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(leads)
    .where(sql`${leads.pipelineStage} = 'active_customer'`);

  const [{ n: replies } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(sql`${events.type} = 'inbound_reply' AND ${events.occurredAt} >= datetime('now','-7 days')`);

  const jobsByKind = (
    await db
      .select({ kind: jobs.kind, status: jobs.status, n: sql<number>`count(*)` })
      .from(jobs)
      .groupBy(jobs.kind, jobs.status)
  ).map((r) => ({ kind: r.kind, status: r.status, n: Number(r.n) }));

  const recentDecisions = (
    await db
      .select({
        at: decisionsLog.createdAt,
        leadId: decisionsLog.leadId,
        decision: decisionsLog.decision,
        rationale: decisionsLog.rationale,
      })
      .from(decisionsLog)
      .orderBy(desc(decisionsLog.createdAt))
      .limit(12)
  );

  return {
    leadsByStage: tally(byStage),
    leadsByChannel: tally(byChannel),
    jobsByKind,
    recentDecisions,
    openExceptions: Number(openExc),
    pendingJobs: Number(pending),
    deadJobs: Number(dead),
    aiSpendUsd: Number(spend),
    costPerLeadUsd: totalLeads > 0 ? Number(spend) / Number(totalLeads) : null,
    costPerActiveCustomerUsd:
      activeCustomers > 0 ? Number(spend) / Number(activeCustomers) : null,
    repliesLast7d: Number(replies),
  };
}
