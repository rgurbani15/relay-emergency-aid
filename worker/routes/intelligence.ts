import { Hono } from "hono";
import type { AppEnv } from "../env";
import { adjustmentSchema, decisionSchema, interpretSchema, runAnalysisSchema, scenarioPreviewSchema, scenarioSaveSchema } from "../../shared/schemas";
import { CATEGORY_IDS, ENGINE } from "../../shared/constants";
import { analyze, compareAnalyses, type Adjustment, type AnalysisResult } from "../../shared/engine";
import { forecastDailyDemand } from "../../shared/forecast";
import { all, auditStmt, first, pageOf, type Row } from "../lib/db";
import { HttpError, conflict, notFound, parse, readJson, toCsv } from "../lib/http";
import { rateLimited } from "../lib/rateLimit";
import { interpretReport } from "../services/ai";
import { BENCHMARK_DATASET, DATASET_VERSION, FIELDS, runBenchmark } from "../services/aiBenchmark";
import { shortId } from "../lib/crypto";
import { getScenario, listScenarios, previewScenario, runAnalysis, saveAllocationRun, saveScenario } from "../services/intelligence";
import { loadSnapshot } from "../services/snapshot";
import { getProgram } from "../services/stats";
import { z } from "zod";

export const intelligenceRoutes = new Hono<AppEnv>();
export const allocationRoutes = new Hono<AppEnv>();

async function programOr404(c: { env: AppEnv["Bindings"]; get: (k: "user") => AppEnv["Variables"]["user"] }, programId: string | undefined) {
  const p = programId ? await getProgram(c.env.DB, c.get("user").orgId, programId) : null;
  if (!p) throw notFound("Program");
  return p;
}

export const FORMULAS = {
  coverage: "Per category: coverage = 1 - unmet demand / forecast demand over 72h, from an hour-by-hour supply simulation (stock + planned shipments vs. forecast demand). With no shipments this equals min(1, inventory / forecast demand). Categories are blended with criticality weights; actual shortage quantities are reported separately.",
  merchantCoverage: "merchantCoverage = min(1, operatingMerchantEquivalents / merchantsNeeded), where open = 1, limited = 0.5, closed = 0. effectiveCapacity = averageCapacity x merchantCoverage, with averageCapacity the mean capacity score of participating merchants that are not closed.",
  viability: `marketViability = ${ENGINE.viabilityWeights.marketAccess} x marketAccess + ${ENGINE.viabilityWeights.merchantCapacity} x effectiveCapacity + ${ENGINE.viabilityWeights.inventoryCoverage} x inventoryCoverage (each normalized 0-1).`,
  procurement: "Direct-supply budget is allocated across projected 72h shortages in whole units, most critical first (category criticality x share of demand unmet), never above the projected shortage quantity or the budget. Costs use average unit prices and are ESTIMATES; unallocated funds are shown. RELAY does not purchase anything.",
  voucherShare: `voucherShare = clamp(${ENGINE.voucherShare.base} + ${ENGINE.voucherShare.slope} x marketViability, ${ENGINE.voucherShare.min}, ${ENGINE.voucherShare.max}); directSupplyShare = 1 - voucherShare.`,
  priority: `priorityShare = ${ENGINE.priorityWeights.population} x populationShare + ${ENGINE.priorityWeights.severity} x severityShare + ${ENGINE.priorityWeights.deficit} x shortageValueShare (each share sums to 1 across communities).`,
  cap: `maxEligibleNeed = people needing assistance x $${ENGINE.perPersonBaseCents / 100} x (0.5 + severity/100) + projected shortage value.`,
  distribution: "Budget basis (program budget minus issued vouchers) is split by priority share in integer cents (largest remainder). Communities that hit their eligible-need cap are fixed at the cap and the excess is redistributed to the others; any remainder that cannot be placed is reported as unallocated.",
  forecast: `Damped-trend exponential smoothing (alpha ${ENGINE.forecast.alpha}, beta ${ENGINE.forecast.beta}, phi ${ENGINE.forecast.phi}) over daily consumption, compared with a ${ENGINE.forecast.baselineWindow}-day moving-average baseline on a rolling-origin holdout. Evaluated on synthetic data only.`,
  caveat: "These are transparent decision rules for a demonstration. They are not scientifically validated, and every recommendation requires human approval before anything is executed.",
  weights: { viability: ENGINE.viabilityWeights, voucherShare: ENGINE.voucherShare, priority: ENGINE.priorityWeights },
};

/* ---------------- Intelligence ---------------- */

intelligenceRoutes.get("/live", async (c) => {
  const p = await programOr404(c, c.req.query("programId"));
  const now = c.get("now")();
  const snapshot = await loadSnapshot(c.env.DB, p.id, now);
  const analysis = analyze(snapshot);
  const series: Record<string, { history: number[]; forecast: number[] }> = {};
  for (const [k, history] of Object.entries(snapshot.history)) series[k] = { history, forecast: forecastDailyDemand(history, 3).map((v) => Math.round(v)) };
  const latest = await first<Row>(c.env.DB, "SELECT id, status, created_at FROM allocation_runs WHERE program_id = ? ORDER BY created_at DESC LIMIT 1", p.id);
  return c.json({ program: p, analysis, series, formulas: FORMULAS, latestRun: latest ? { id: latest.id, status: latest.status, createdAt: latest.created_at } : null });
});

intelligenceRoutes.get("/options", async (c) => {
  const p = await programOr404(c, c.req.query("programId"));
  const snap = await loadSnapshot(c.env.DB, p.id, c.get("now")());
  return c.json({ communities: snap.communities.map((x) => ({ id: x.id, name: x.name })), merchants: snap.merchants.map((m) => ({ id: m.id, name: m.name, communityId: m.communityId, status: m.status, capacityScore: m.capacityScore })), shipments: snap.shipments.map((s) => ({ id: s.id, communityId: s.communityId, category: s.category, quantity: s.quantity, etaHours: Math.round(s.etaHours), label: s.label })), categories: CATEGORY_IDS });
});

intelligenceRoutes.post("/run", async (c) => {
  const user = c.get("user");
  const b = parse(runAnalysisSchema, await readJson(c.req.raw));
  const p = await programOr404(c, b.programId);
  if (p.status === "closed") throw conflict("Closed programs cannot be analysed.", "program_closed");
  const { runId } = await runAnalysis(c.env.DB, user, p.id, b.analysisDays, c.get("now")());
  return c.json({ runId }, 201);
});

intelligenceRoutes.post("/scenarios/preview", async (c) => {
  const b = parse(scenarioPreviewSchema, await readJson(c.req.raw));
  const p = await programOr404(c, b.programId);
  return c.json(await previewScenario(c.env.DB, p.id, b.adjustments as Adjustment[], c.get("now")()));
});

intelligenceRoutes.get("/scenarios", async (c) => {
  const p = await programOr404(c, c.req.query("programId"));
  return c.json({ items: await listScenarios(c.env.DB, p.id) });
});
intelligenceRoutes.get("/scenarios/:id", async (c) => {
  const s = await getScenario(c.env.DB, c.req.param("id"));
  if (!s) throw notFound("Scenario");
  await programOr404(c, s.programId);
  return c.json({ scenario: s });
});

/** Saving a scenario snapshot is an explicit, confirmed action. It stores an overlay; it never edits inventory, merchants or history. */
intelligenceRoutes.post("/scenarios", async (c) => {
  const user = c.get("user");
  const b = parse(scenarioSaveSchema, await readJson(c.req.raw));
  const p = await programOr404(c, b.programId);
  const saved = await saveScenario(c.env.DB, user, p.id, b.name, b.adjustments as Adjustment[], b.source, b.sourceText, b.aiProposal, c.get("now")());
  return c.json({ scenario: saved }, 201);
});

intelligenceRoutes.post("/scenarios/:id/allocation-run", async (c) => {
  const user = c.get("user");
  const s = await getScenario(c.env.DB, c.req.param("id"));
  if (!s) throw notFound("Scenario");
  await programOr404(c, s.programId);
  const now = c.get("now")();
  const snapshot = await loadSnapshot(c.env.DB, s.programId, now);
  const result = analyze(snapshot, s.adjustments);
  const runId = await saveAllocationRun(c.env.DB, user, snapshot, result, now, { analysisDays: 30, scenarioRunId: s.id, adjustments: s.adjustments });
  return c.json({ runId }, 201);
});

/** AI Scenario Interpreter: extracts a PROPOSAL only. Nothing is applied or saved here. */
intelligenceRoutes.post("/interpret", async (c) => {
  const user = c.get("user");
  if (rateLimited(`ai:${user.id}`, 10, 60_000, c.get("now")().getTime())) throw new HttpError(429, "rate_limited", "Too many AI requests. Wait a moment and try again.");
  const b = parse(interpretSchema, await readJson(c.req.raw));
  const p = await programOr404(c, b.programId);
  const snap = await loadSnapshot(c.env.DB, p.id, c.get("now")());
  const result = await interpretReport(c.env, b.text, { communities: snap.communities.map((x) => ({ id: x.id, name: x.name })), merchants: snap.merchants.map((m) => ({ id: m.id, name: m.name, communityId: m.communityId })) });
  await c.env.DB.batch([auditStmt(c.env.DB, user, "scenario.ai_interpreted", "scenario", null, p.id, { model: result.model, adjustments: result.adjustments.length, warnings: result.warnings.length }, c.get("now")().toISOString())]);
  return c.json({ ...result, sourceText: b.text });
});
void adjustmentSchema; void z;

/* ---------------- AI evaluation (measured, never hardcoded) ---------------- */

const evalRunDto = (r: Row) => ({ id: r.id, model: r.model, datasetVersion: r.dataset_version, datasetSize: r.dataset_size, createdAt: r.created_at, createdBy: r.created_by, metrics: JSON.parse(r.metrics_json), results: JSON.parse(r.results_json) });

intelligenceRoutes.get("/ai-eval", async (c) => {
  const p = await programOr404(c, c.req.query("programId"));
  const latest = await first<Row>(c.env.DB, "SELECT * FROM ai_eval_runs WHERE program_id = ? ORDER BY created_at DESC LIMIT 1", p.id);
  const history = await all<Row>(c.env.DB, "SELECT id, model, dataset_size, created_at, metrics_json FROM ai_eval_runs WHERE program_id = ? ORDER BY created_at DESC LIMIT 5", p.id);
  return c.json({
    aiAvailable: !!c.env.AI,
    dataset: { version: DATASET_VERSION, synthetic: true, size: BENCHMARK_DATASET.length, fields: FIELDS, reports: BENCHMARK_DATASET },
    latest: latest ? evalRunDto(latest) : null,
    history: history.map((h) => ({ id: h.id, model: h.model, datasetSize: h.dataset_size, createdAt: h.created_at, fieldAccuracy: JSON.parse(h.metrics_json).fieldAccuracy })),
    disclosure: "Synthetic benchmark: the incident reports and their expected answers were written for this demonstration. Scores describe this dataset and the configured model only. AI output is a reviewable proposal; it never changes balances, vouchers, ledger entries or allocations.",
  });
});

/** Runs every benchmark report through the real Workers AI interpreter and stores the measured results. Read-only with respect to financial data. */
intelligenceRoutes.post("/ai-eval/run", async (c) => {
  const user = c.get("user");
  if (rateLimited(`aieval:${user.id}`, 3, 600_000, c.get("now")().getTime())) throw new HttpError(429, "rate_limited", "The benchmark was run recently. Wait a few minutes before running it again.");
  const b = parse(z.object({ programId: z.string().min(1) }), await readJson(c.req.raw));
  const p = await programOr404(c, b.programId);
  const snap = await loadSnapshot(c.env.DB, p.id, c.get("now")());
  const ctx = { communities: snap.communities.map((x) => ({ id: x.id, name: x.name })), merchants: snap.merchants.map((m) => ({ id: m.id, name: m.name, communityId: m.communityId })) };
  const out = await runBenchmark(c.env, ctx);
  const id = shortId("aie");
  const nowIso = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO ai_eval_runs (id, program_id, model, dataset_version, dataset_size, metrics_json, results_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, p.id, out.model, DATASET_VERSION, out.results.length, JSON.stringify(out.metrics), JSON.stringify(out.results), user.id, nowIso),
    auditStmt(c.env.DB, user, "ai.benchmark_run", "ai_eval", id, p.id, { model: out.model, reports: out.results.length, fieldAccuracy: out.metrics.fieldAccuracy }, nowIso),
  ]);
  const row = await first<Row>(c.env.DB, "SELECT * FROM ai_eval_runs WHERE id = ?", id);
  return c.json(evalRunDto(row!), 201);
});

/* ---------------- Allocations ---------------- */

const runDto = (r: Row, programName?: string) => ({
  id: r.id, programId: r.program_id, programName: programName ?? r.program_name, status: r.status, analysisDays: r.analysis_days, budgetBasisCents: r.budget_basis_cents,
  totalRecommendedCents: r.total_recommended_cents, voucherCents: r.voucher_cents, directSupplyCents: r.direct_supply_cents, unallocatedCents: r.unallocated_cents,
  communitiesEvaluated: r.communities_evaluated, scenarioRunId: r.scenario_run_id, createdAt: r.created_at, createdBy: r.created_by, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionReason: r.decision_reason,
});

allocationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q, 10);
  const where = ["p.org_id = ?"], params: unknown[] = [user.orgId];
  if (q.programId) { where.push("a.program_id = ?"); params.push(q.programId); }
  if (q.status && q.status !== "all") { where.push("a.status = ?"); params.push(q.status); }
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n FROM allocation_runs a JOIN programs p ON p.id = a.program_id WHERE ${where.join(" AND ")}`, ...params))!.n;
  const rows = await all<Row>(c.env.DB, `SELECT a.*, p.name AS program_name, u.name AS creator_name FROM allocation_runs a JOIN programs p ON p.id = a.program_id LEFT JOIN users u ON u.id = a.created_by WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  return c.json({ total, page, pageSize, items: rows.map((r) => ({ ...runDto(r), createdByName: r.creator_name })) });
});

async function loadRun(c: { env: AppEnv["Bindings"]; get: (k: "user") => AppEnv["Variables"]["user"] }, id: string) {
  const run = await first<Row>(c.env.DB, "SELECT a.*, p.name AS program_name, p.org_id FROM allocation_runs a JOIN programs p ON p.id = a.program_id WHERE a.id = ?", id);
  if (!run || run.org_id !== c.get("user").orgId) throw notFound("Allocation run");
  return run;
}

allocationRoutes.get("/compare", async (c) => {
  const a = await loadRun(c, c.req.query("a") ?? ""), b = await loadRun(c, c.req.query("b") ?? "");
  const load = async (id: string) => (await all<Row>(c.env.DB, "SELECT detail_json FROM allocation_recommendations WHERE run_id = ?", id)).map((r) => JSON.parse(r.detail_json));
  const [ca, cb] = [await load(a.id), await load(b.id)];
  const comparison = compareAnalyses({ communities: ca } as AnalysisResult, { communities: cb } as AnalysisResult);
  return c.json({ a: runDto(a), b: runDto(b), comparison });
});

allocationRoutes.get("/:id", async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const recs = await all<Row>(c.env.DB, "SELECT ar.detail_json, c.name FROM allocation_recommendations ar JOIN communities c ON c.id = ar.community_id WHERE ar.run_id = ? ORDER BY ar.recommended_cents DESC", run.id);
  const metrics = JSON.parse(run.metrics_json);
  const scenario = run.scenario_run_id ? await first<Row>(c.env.DB, "SELECT id, name FROM scenario_runs WHERE id = ?", run.scenario_run_id) : null;
  return c.json({ run: runDto(run), recommendations: recs.map((r) => JSON.parse(r.detail_json)), metrics, scenario, formulas: FORMULAS, notes: metrics.notes ?? [] });
});

allocationRoutes.post("/:id/approve", async (c) => {
  const user = c.get("user");
  const run = await loadRun(c, c.req.param("id"));
  if (run.status !== "pending_approval") throw conflict(`This run is ${run.status.replace("_", " ")} and can no longer be approved.`, "invalid_state");
  const program = (await getProgram(c.env.DB, user.orgId, run.program_id))!;
  if (program.status === "closed") throw conflict("The program is closed.", "program_closed");
  if (run.total_recommended_cents > program.budgetCents - program.issuedCents) throw conflict("Vouchers issued since this run was generated reduce the available budget below the recommended total. Run a fresh analysis.", "budget_changed");
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE allocation_runs SET status = 'superseded' WHERE program_id = ? AND status = 'approved'").bind(run.program_id),
    c.env.DB.prepare("UPDATE allocation_runs SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending_approval'").bind(user.id, now, run.id),
    auditStmt(c.env.DB, user, "allocation.approved", "allocation_run", run.id, run.program_id, { totalCents: run.total_recommended_cents, voucherCents: run.voucher_cents, directSupplyCents: run.direct_supply_cents, note: "Approval records a plan only; no funds, vouchers or procurement are executed." }, now),
  ]);
  return c.json({ run: runDto(await loadRun(c, run.id)) });
});

allocationRoutes.post("/:id/reject", async (c) => {
  const user = c.get("user");
  const run = await loadRun(c, c.req.param("id"));
  const b = parse(decisionSchema, await readJson(c.req.raw));
  if (run.status !== "pending_approval") throw conflict(`This run is ${run.status.replace("_", " ")} and can no longer be rejected.`, "invalid_state");
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE allocation_runs SET status = 'rejected', decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ? AND status = 'pending_approval'").bind(user.id, now, b.reason, run.id),
    auditStmt(c.env.DB, user, "allocation.rejected", "allocation_run", run.id, run.program_id, { reason: b.reason }, now),
  ]);
  return c.json({ run: runDto(await loadRun(c, run.id)) });
});

allocationRoutes.get("/:id/export", async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const recs = await all<Row>(c.env.DB, "SELECT ar.*, c.name FROM allocation_recommendations ar JOIN communities c ON c.id = ar.community_id WHERE ar.run_id = ? ORDER BY c.name", run.id);
  const csv = toCsv(["allocation_id", "program", "status", "community", "market_viability", "priority_share", "recommended_usd", "voucher_usd", "direct_supply_usd", "voucher_pct", "direct_pct"],
    recs.map((r) => [run.id, run.program_name, run.status, r.name, r.market_viability.toFixed(3), r.priority_share.toFixed(3), (r.recommended_cents / 100).toFixed(2), (r.voucher_cents / 100).toFixed(2), (r.direct_cents / 100).toFixed(2), (r.voucher_pct * 100).toFixed(1), (r.direct_pct * 100).toFixed(1)]));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="relay-allocation-${run.id}.csv"` } });
});
