import type { SessionUser } from "../env";
import { analyze, compareAnalyses, type Adjustment, type AnalysisResult, type EngineSnapshot } from "../../shared/engine";
import { all, auditStmt, first, type Row } from "../lib/db";
import { shortId } from "../lib/crypto";
import { loadSnapshot } from "./snapshot";

/** Persist an allocation run (recommendations + forecasts) in one batch. Recommendations are plans only:
 * nothing here moves money, issues vouchers or procures supplies. */
export async function saveAllocationRun(
  db: D1Database, user: SessionUser, snapshot: EngineSnapshot, result: AnalysisResult, now: Date,
  opts: { analysisDays: number; scenarioRunId?: string | null; adjustments?: Adjustment[] } = { analysisDays: 30 },
): Promise<string> {
  const nowIso = now.toISOString();
  const runId = shortId("alr");
  const s: D1PreparedStatement[] = [
    db.prepare("UPDATE allocation_runs SET status = 'superseded' WHERE program_id = ? AND status = 'pending_approval'").bind(snapshot.program.id),
    db.prepare(
      `INSERT INTO allocation_runs (id, program_id, status, analysis_days, budget_basis_cents, total_recommended_cents, voucher_cents, direct_supply_cents, unallocated_cents, communities_evaluated, inputs_json, metrics_json, scenario_run_id, created_by, created_at)
       VALUES (?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(runId, snapshot.program.id, opts.analysisDays, result.budgetBasisCents, result.totals.recommendedCents, result.totals.voucherCents, result.totals.directCents, result.totals.unallocatedCents, result.communities.length, JSON.stringify({ snapshot, adjustments: opts.adjustments ?? [] }), JSON.stringify({ forecastEvaluation: result.forecastEvaluation, totals: result.totals, notes: result.notes }), opts.scenarioRunId ?? null, user.id, nowIso),
  ];
  for (const c of result.communities) {
    s.push(db.prepare(
      `INSERT INTO allocation_recommendations (id, run_id, community_id, market_viability, priority_share, recommended_cents, voucher_pct, direct_pct, voucher_cents, direct_cents, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(`${runId}_${c.communityId}`, runId, c.communityId, c.marketViability, c.priorityShare, c.recommendedCents, c.voucherPct, c.directPct, c.voucherCents, c.directCents, JSON.stringify(c)));
    for (const ca of c.categories) {
      const f = [ca.forecast24, ca.forecast48, ca.forecast72];
      [24, 48, 72].forEach((h, k) => s.push(db.prepare(
        "INSERT INTO demand_forecasts (id, allocation_run_id, community_id, category, horizon_hours, forecast_units, method, generated_at) VALUES (?, ?, ?, ?, ?, ?, 'damped_holt_v1', ?)",
      ).bind(`${runId}_${c.communityId}_${ca.category}_${h}`, runId, c.communityId, ca.category, h, Math.round(f[k] * 100) / 100, nowIso)));
    }
  }
  s.push(auditStmt(db, user, opts.scenarioRunId ? "allocation.generated_from_scenario" : "allocation.generated", "allocation_run", runId, snapshot.program.id, { communities: result.communities.length, totalCents: result.totals.recommendedCents, scenarioRunId: opts.scenarioRunId ?? null }, nowIso));
  await db.batch(s);
  return runId;
}

export async function runAnalysis(db: D1Database, user: SessionUser, programId: string, analysisDays: number, now: Date) {
  const snapshot = await loadSnapshot(db, programId, now, analysisDays);
  const result = analyze(snapshot);
  const runId = await saveAllocationRun(db, user, snapshot, result, now, { analysisDays });
  return { runId, result };
}

export async function previewScenario(db: D1Database, programId: string, adjustments: Adjustment[], now: Date) {
  const snapshot = await loadSnapshot(db, programId, now);
  const baseline = analyze(snapshot);
  const adjusted = analyze(snapshot, adjustments);
  return { baseline, adjusted, comparison: compareAnalyses(baseline, adjusted), notes: adjusted.notes };
}

export function adjustmentKey(a: Adjustment): { community: string | null; merchant: string | null; category: string | null } {
  return {
    community: "communityId" in a ? (a.communityId ?? null) : null,
    merchant: a.kind === "merchant_status" ? a.merchantId : null,
    category: "category" in a ? (a.category ?? null) : null,
  };
}

export async function saveScenario(
  db: D1Database, user: SessionUser, programId: string, name: string, adjustments: Adjustment[], source: "manual" | "ai", sourceText: string | undefined, aiProposal: unknown, now: Date,
) {
  const nowIso = now.toISOString();
  const preview = await previewScenario(db, programId, adjustments, now);
  const id = shortId("scn");
  const types = [...new Set(adjustments.map((a) => a.kind))];
  const type = types.length === 1 ? types[0] : adjustments.length === 0 ? "baseline" : "custom";
  const s: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO scenario_runs (id, program_id, name, scenario_type, source, source_text, ai_proposal_json, baseline_json, adjusted_json, comparison_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, programId, name, type, source, sourceText ?? null, aiProposal ? JSON.stringify(aiProposal) : null, JSON.stringify(preview.baseline), JSON.stringify(preview.adjusted), JSON.stringify({ comparison: preview.comparison, notes: preview.notes, adjustments }), user.id, nowIso),
  ];
  adjustments.forEach((a, n) => {
    const k = adjustmentKey(a);
    s.push(db.prepare("INSERT INTO scenario_adjustments (id, scenario_run_id, kind, community_id, merchant_id, category, params_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(`${id}_${n + 1}`, id, a.kind, k.community, k.merchant, k.category, JSON.stringify(a), nowIso));
  });
  s.push(auditStmt(db, user, "scenario.created", "scenario", id, programId, { name, source, adjustments: adjustments.length }, nowIso));
  await db.batch(s);
  return { id, ...preview };
}

export async function listScenarios(db: D1Database, programId: string) {
  return all<Row>(db, "SELECT id, name, scenario_type, source, created_at, created_by FROM scenario_runs WHERE program_id = ? ORDER BY created_at DESC LIMIT 20", programId);
}
export async function getScenario(db: D1Database, id: string) {
  const r = await first<Row>(db, "SELECT * FROM scenario_runs WHERE id = ?", id);
  if (!r) return null;
  const cmp = JSON.parse(r.comparison_json);
  return { id: r.id, programId: r.program_id, name: r.name, type: r.scenario_type, source: r.source, sourceText: r.source_text, createdAt: r.created_at, baseline: JSON.parse(r.baseline_json), adjusted: JSON.parse(r.adjusted_json), comparison: cmp.comparison, notes: cmp.notes, adjustments: cmp.adjustments as Adjustment[] };
}
