import type { AnalysisResult } from "../../shared/engine";
import { formatCents } from "../../shared/money";
import { all, type Row } from "../lib/db";

export interface Alert { id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; communityId?: string; kind: string }

/** Alerts are derived from live data (engine output, merchant status, budget), never hand-written. */
export async function buildAlerts(db: D1Database, analysis: AnalysisResult, program: { budgetCents: number; issuedCents: number; allocatedCents: number }, communityNames: Record<string, string>): Promise<Alert[]> {
  const alerts: Alert[] = [];
  for (const c of analysis.communities) {
    for (const ca of c.categories) {
      if (ca.stockoutHours !== null && ca.forecast72 > 0 && ca.coverage < 0.8) {
        const sev = ca.stockoutHours < 24 ? "critical" : "warning";
        alerts.push({ id: `stockout-${c.communityId}-${ca.category}`, kind: "shortage_forecast", severity: sev, communityId: c.communityId, title: `${ca.label} shortage forecast in ${c.name}`, detail: `Projected stock-out in about ${Math.max(1, Math.round(ca.stockoutHours))}h; ${Math.round((1 - ca.coverage) * 100)}% of 72h demand (${Math.round(ca.forecast72).toLocaleString("en-US")} units) is unmet.` });
      }
    }
    if (c.inventoryCoverage < 0.7) {
      alerts.push({ id: `coverage-${c.communityId}`, kind: "inventory_below_demand", severity: c.inventoryCoverage < 0.4 ? "critical" : "warning", communityId: c.communityId, title: `${c.name} inventory below expected demand`, detail: `Weighted inventory coverage is ${Math.round(c.inventoryCoverage * 100)}% of 72h forecast demand; ${c.operatingMerchants} of ${c.participatingMerchants} merchants operating.` });
    }
  }
  const merchants = await all<Row>(db, `SELECT m.id, m.name, m.status, m.community_id FROM merchants m JOIN program_communities pc ON pc.community_id = m.community_id WHERE pc.program_id = ? AND m.participating = 1 AND m.status != 'open'`, analysis.programId);
  for (const m of merchants) alerts.push({ id: `merchant-${m.id}`, kind: "merchant_status", severity: m.status === "closed" ? "warning" : "info", communityId: m.community_id, title: `${m.name} is ${m.status === "closed" ? "closed" : "operating at limited capacity"}`, detail: `Merchant status in ${communityNames[m.community_id] ?? "community"} reduces local market capacity in the viability calculation.` });
  const committedPct = program.budgetCents > 0 ? Math.max(program.issuedCents, program.allocatedCents) / program.budgetCents : 0;
  if (committedPct >= 0.8) alerts.push({ id: "budget", kind: "budget_limit", severity: committedPct >= 0.95 ? "critical" : "warning", title: "Emergency program approaching budget limit", detail: `${Math.round(committedPct * 100)}% of ${formatCents(program.budgetCents)} is issued or allocated.` });
  const low = await all<Row>(db, `SELECT COUNT(*) n FROM inventory_items i JOIN program_communities pc ON pc.community_id = i.community_id WHERE pc.program_id = ? AND i.quantity <= i.min_threshold * 0.5`, analysis.programId);
  if ((low[0]?.n ?? 0) > 0) alerts.push({ id: "critical-stock", kind: "critical_stock", severity: "info", title: `${low[0].n} inventory records at critical or zero stock`, detail: "Review the Inventory page filtered by stock level." });
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 12);
}
