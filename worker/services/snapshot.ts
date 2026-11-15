import type { Category } from "../../shared/constants";
import type { EngineSnapshot } from "../../shared/engine";
import { all, first, type Row } from "../lib/db";

export async function committedCents(db: D1Database, programId: string): Promise<number> {
  const r = await first<Row>(db, "SELECT COALESCE(SUM(amount_cents),0) AS n FROM vouchers WHERE program_id = ? AND status != 'cancelled'", programId);
  return r?.n ?? 0;
}

/** Assemble the pure-data engine snapshot for a program from D1 (current state, never mutated by scenarios). */
export async function loadSnapshot(db: D1Database, programId: string, now: Date, historyDays = 30): Promise<EngineSnapshot> {
  const program = await first<Row>(db, "SELECT id, name, budget_cents FROM programs WHERE id = ?", programId);
  if (!program) throw new Error("Program not found");
  const communities = await all<Row>(
    db,
    `SELECT c.* FROM communities c JOIN program_communities pc ON pc.community_id = c.id WHERE pc.program_id = ? AND c.status = 'active' ORDER BY c.name`,
    programId,
  );
  const ids = communities.map((c) => c.id);
  const ph = ids.map(() => "?").join(",") || "''";
  const merchants = ids.length ? await all<Row>(db, `SELECT * FROM merchants WHERE community_id IN (${ph}) ORDER BY name`, ...ids) : [];
  const inventory = ids.length ? await all<Row>(db, `SELECT * FROM inventory_items WHERE community_id IN (${ph})`, ...ids) : [];
  const shipments = ids.length ? await all<Row>(db, `SELECT * FROM planned_shipments WHERE community_id IN (${ph}) AND status = 'in_transit'`, ...ids) : [];
  const obs = ids.length
    ? await all<Row>(db, `SELECT community_id, category, day, units_consumed FROM daily_demand_observations WHERE community_id IN (${ph}) ORDER BY day ASC`, ...ids)
    : [];
  const history: Record<string, number[]> = {};
  for (const o of obs) (history[`${o.community_id}|${o.category}`] ??= []).push(o.units_consumed);
  for (const k of Object.keys(history)) history[k] = history[k].slice(-historyDays);

  return {
    asOf: now.toISOString(),
    program: { id: program.id, name: program.name, budgetCents: program.budget_cents, committedCents: await committedCents(db, programId) },
    communities: communities.map((c) => ({ id: c.id, name: c.name, populationNeeding: c.population_needing, needSeverity: c.need_severity, marketAccess: c.market_access_score, merchantsNeeded: c.merchants_needed, diagramX: c.diagram_x, diagramY: c.diagram_y })),
    merchants: merchants.map((m) => ({ id: m.id, communityId: m.community_id, name: m.name, status: m.status, capacityScore: m.capacity_score, participating: !!m.participating })),
    inventory: inventory.map((i) => ({ id: i.id, merchantId: i.merchant_id, communityId: i.community_id, category: i.category as Category, quantity: i.quantity, unitPriceCents: i.unit_price_cents, name: i.name })),
    shipments: shipments.map((s) => ({ id: s.id, communityId: s.community_id, category: s.category as Category, quantity: s.quantity, etaHours: Math.max(0, (Date.parse(s.eta) - now.getTime()) / 3_600_000), label: s.label })),
    history,
  };
}
