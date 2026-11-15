import { Hono } from "hono";
import type { AppEnv } from "../env";
import { decisionSchema } from "../../shared/schemas";
import { analyze } from "../../shared/engine";
import { categoryLabel } from "../../shared/constants";
import { all, auditStmt, first, likeTerm, pageOf, type Row } from "../lib/db";
import { shortId } from "../lib/crypto";
import { conflict, notFound, parse, readJson, toCsv } from "../lib/http";
import { loadSnapshot } from "../services/snapshot";
import { PROGRAM_STATS_SQL, programDto } from "../services/stats";

export const financeRoutes = new Hono<AppEnv>();
const usd = (c: number) => (c / 100).toFixed(2);

const claimDto = (r: Row) => ({ id: r.id, merchantId: r.merchant_id, merchantName: r.merchant_name, programId: r.program_id, programName: r.program_name, amountCents: r.amount_cents, itemCount: r.item_count, status: r.status, rejectionReason: r.rejection_reason, createdAt: r.created_at, decidedAt: r.decided_at, decidedByName: r.decider_name });
const CLAIM_SQL = `SELECT cl.*, m.name AS merchant_name, p.name AS program_name, u.name AS decider_name FROM reimbursement_claims cl JOIN merchants m ON m.id = cl.merchant_id JOIN programs p ON p.id = cl.program_id LEFT JOIN users u ON u.id = cl.decided_by`;

financeRoutes.get("/reconciliation", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q, 10);
  const where = ["p.org_id = ?"], params: unknown[] = [user.orgId];
  if (q.programId) { where.push("cl.program_id = ?"); params.push(q.programId); }
  if (q.merchantId) { where.push("cl.merchant_id = ?"); params.push(q.merchantId); }
  const filtered = [...where], fp = [...params];
  if (q.status && q.status !== "all") { filtered.push("cl.status = ?"); fp.push(q.status); }
  if (q.q) { filtered.push("(cl.id LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\')"); fp.push(likeTerm(q.q), likeTerm(q.q)); }
  const base = "FROM reimbursement_claims cl JOIN merchants m ON m.id = cl.merchant_id JOIN programs p ON p.id = cl.program_id";
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n ${base} WHERE ${filtered.join(" AND ")}`, ...fp))!.n;
  const rows = await all<Row>(c.env.DB, `${CLAIM_SQL} WHERE ${filtered.join(" AND ")} ORDER BY CASE cl.status WHEN 'pending' THEN 0 ELSE 1 END, cl.created_at DESC LIMIT ? OFFSET ?`, ...fp, pageSize, offset);
  const sums = await all<Row>(c.env.DB, `SELECT cl.status, COUNT(*) n, COALESCE(SUM(cl.amount_cents),0) cents ${base} WHERE ${where.join(" AND ")} GROUP BY cl.status`, ...params);
  const by = Object.fromEntries(sums.map((s) => [s.status, { count: s.n, cents: s.cents }]));
  const g = (k: string) => by[k] ?? { count: 0, cents: 0 };
  return c.json({
    total, page, pageSize, items: rows.map(claimDto),
    summary: { totalClaims: { count: g("pending").count + g("approved").count + g("rejected").count, cents: g("pending").cents + g("approved").cents + g("rejected").cents }, pending: g("pending"), approved: g("approved"), rejected: g("rejected"), outstanding: { count: g("pending").count + g("approved").count, cents: g("pending").cents + g("approved").cents } },
  });
});

financeRoutes.get("/reconciliation/claims/:id", async (c) => {
  const user = c.get("user");
  const r = await first<Row>(c.env.DB, `${CLAIM_SQL} WHERE cl.id = ? AND p.org_id = ?`, c.req.param("id"), user.orgId);
  if (!r) throw notFound("Claim");
  const items = await all<Row>(c.env.DB, `SELECT ri.amount_cents, ri.voided, rd.id AS redemption_id, rd.receipt_no, rd.created_at, rd.status, v.public_code, rd.resident_id FROM reimbursement_items ri JOIN redemptions rd ON rd.id = ri.redemption_id JOIN vouchers v ON v.id = rd.voucher_id WHERE ri.claim_id = ? ORDER BY rd.created_at`, r.id);
  return c.json({ claim: claimDto(r), items: items.map((i) => ({ redemptionId: i.redemption_id, receiptNo: i.receipt_no, createdAt: i.created_at, amountCents: i.amount_cents, voided: !!i.voided, status: i.status, voucherCode: i.public_code, residentId: i.resident_id })) });
});

financeRoutes.post("/reconciliation/claims/:id/approve", async (c) => {
  const user = c.get("user");
  const r = await first<Row>(c.env.DB, `${CLAIM_SQL} WHERE cl.id = ? AND p.org_id = ?`, c.req.param("id"), user.orgId);
  if (!r) throw notFound("Claim");
  if (r.status !== "pending") throw conflict(`This claim is already ${r.status}.`, "invalid_state");
  if (r.amount_cents <= 0) throw conflict("A claim with no value cannot be approved.", "empty_claim");
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE reimbursement_claims SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'").bind(now, user.id, r.id),
    auditStmt(c.env.DB, user, "claim.approved", "claim", r.id, r.program_id, { amountCents: r.amount_cents, merchant: r.merchant_id, note: "Approval does not constitute payment; no payout integration exists." }, now),
  ]);
  return c.json({ claim: claimDto((await first<Row>(c.env.DB, `${CLAIM_SQL} WHERE cl.id = ?`, r.id))!) });
});

financeRoutes.post("/reconciliation/claims/:id/reject", async (c) => {
  const user = c.get("user");
  const r = await first<Row>(c.env.DB, `${CLAIM_SQL} WHERE cl.id = ? AND p.org_id = ?`, c.req.param("id"), user.orgId);
  if (!r) throw notFound("Claim");
  const b = parse(decisionSchema, await readJson(c.req.raw));
  if (r.status !== "pending") throw conflict(`This claim is already ${r.status}.`, "invalid_state");
  const items = await all<Row>(c.env.DB, `SELECT ri.redemption_id, ri.amount_cents, l.id AS ledger_id, l.voucher_id FROM reimbursement_items ri LEFT JOIN ledger_entries l ON l.redemption_id = ri.redemption_id AND l.entry_type = 'reimbursement_claim_created' WHERE ri.claim_id = ? AND ri.voided = 0`, r.id);
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE reimbursement_claims SET status = 'rejected', decided_at = ?, decided_by = ?, rejection_reason = ? WHERE id = ? AND status = 'pending'").bind(now, user.id, b.reason, r.id),
    // Rejection posts reversal entries so the merchant receivable nets to zero without editing history.
    ...items.map((i, n) => c.env.DB.prepare("INSERT INTO ledger_entries (id, program_id, account_type, merchant_id, voucher_id, redemption_id, entry_type, amount_cents, memo, reverses_entry_id, created_by, created_at) VALUES (?, ?, 'merchant', ?, ?, ?, 'reimbursement_claim_reversed', ?, ?, ?, ?, ?)").bind(`${r.id}_rej${n}_${shortId("l").slice(2, 6)}`, r.program_id, r.merchant_id, i.voucher_id, i.redemption_id, -i.amount_cents, `Claim ${r.id} rejected: ${b.reason}`, i.ledger_id, user.id, now)),
    auditStmt(c.env.DB, user, "claim.rejected", "claim", r.id, r.program_id, { amountCents: r.amount_cents, merchant: r.merchant_id, reason: b.reason }, now),
  ]);
  return c.json({ claim: claimDto((await first<Row>(c.env.DB, `${CLAIM_SQL} WHERE cl.id = ?`, r.id))!) });
});

/* ---------------- Reports ---------------- */

export const REPORTS: Record<string, string> = {
  budget_usage: "Program budget usage",
  voucher_activity: "Voucher issuance and redemption",
  community_allocation: "Community allocation",
  merchant_reimbursement: "Merchant reimbursement",
  inventory_movements: "Inventory movements",
  forecast_performance: "Demand forecast performance",
};

financeRoutes.get("/reports", (c) => c.json({ reports: Object.entries(REPORTS).map(([id, title]) => ({ id, title })) }));

financeRoutes.get("/reports/:type", async (c) => {
  const user = c.get("user");
  const type = c.req.param("type");
  if (!REPORTS[type]) throw notFound("Report");
  const programId = c.req.query("programId");
  const db = c.env.DB;
  let columns: string[] = [];
  let rows: (string | number | null)[][] = [];
  let note: string | undefined;

  if (type === "budget_usage") {
    const ps = (await all<Row>(db, `${PROGRAM_STATS_SQL} WHERE p.org_id = ?${programId ? " AND p.id = ?" : ""} ORDER BY p.name`, ...(programId ? [user.orgId, programId] : [user.orgId]))).map(programDto);
    columns = ["Program", "Status", "Budget (USD)", "Issued as vouchers (USD)", "Approved allocation plan (USD)", "Redeemed (USD)", "Outstanding merchant claims (USD)", "Unissued budget (USD)", "Issued % of budget"];
    rows = ps.map((p) => [p.name, p.status, usd(p.budgetCents), usd(p.issuedCents), usd(p.allocatedCents), usd(p.redeemedCents), usd(p.outstandingClaimsCents), usd(p.budgetCents - p.issuedCents), p.budgetCents ? ((p.issuedCents / p.budgetCents) * 100).toFixed(1) : "0.0"]);
  } else if (type === "voucher_activity") {
    const r = await all<Row>(db, `SELECT v.*, p.name AS program_name, rs.name AS resident_name FROM vouchers v JOIN programs p ON p.id = v.program_id JOIN residents rs ON rs.id = v.resident_id WHERE p.org_id = ?${programId ? " AND v.program_id = ?" : ""} ORDER BY v.issued_at DESC`, ...(programId ? [user.orgId, programId] : [user.orgId]));
    columns = ["Voucher", "Program", "Resident ID", "Resident", "Issued (USD)", "Redeemed (USD)", "Remaining (USD)", "Status", "Issued at", "Expires at"];
    rows = r.map((v) => [v.public_code, v.program_name, v.resident_id, v.resident_name, usd(v.amount_cents), usd(v.amount_cents - v.remaining_cents), usd(v.remaining_cents), v.status, v.issued_at, v.expires_at]);
  } else if (type === "community_allocation") {
    const r = await all<Row>(db, `SELECT a.id AS run_id, a.status, a.created_at, p.name AS program_name, c.name AS community_name, ar.* FROM allocation_recommendations ar JOIN allocation_runs a ON a.id = ar.run_id JOIN programs p ON p.id = a.program_id JOIN communities c ON c.id = ar.community_id WHERE p.org_id = ?${programId ? " AND a.program_id = ?" : ""} ORDER BY a.created_at DESC, c.name`, ...(programId ? [user.orgId, programId] : [user.orgId]));
    columns = ["Run", "Run status", "Program", "Community", "Market viability", "Recommended (USD)", "Voucher (USD)", "Direct supply (USD)", "Voucher %", "Generated at"];
    rows = r.map((x) => [x.run_id, x.status, x.program_name, x.community_name, x.market_viability.toFixed(3), usd(x.recommended_cents), usd(x.voucher_cents), usd(x.direct_cents), (x.voucher_pct * 100).toFixed(1), x.created_at]);
  } else if (type === "merchant_reimbursement") {
    const r = await all<Row>(db, `${CLAIM_SQL} WHERE p.org_id = ?${programId ? " AND cl.program_id = ?" : ""} ORDER BY cl.created_at DESC`, ...(programId ? [user.orgId, programId] : [user.orgId]));
    columns = ["Claim", "Merchant", "Program", "Redemptions", "Amount (USD)", "Status", "Created", "Decided", "Rejection reason"];
    rows = r.map((x) => [x.id, x.merchant_name, x.program_name, x.item_count, usd(x.amount_cents), x.status, x.created_at, x.decided_at, x.rejection_reason]);
    note = "Approved claims are not payments. RELAY has no payout integration.";
  } else if (type === "inventory_movements") {
    const r = await all<Row>(db, `SELECT mv.*, i.name AS item_name, i.category, m.name AS merchant_name, c.name AS community_name FROM inventory_movements mv JOIN inventory_items i ON i.id = mv.inventory_item_id JOIN merchants m ON m.id = mv.merchant_id JOIN communities c ON c.id = mv.community_id WHERE m.org_id = ?${programId ? " AND mv.community_id IN (SELECT community_id FROM program_communities WHERE program_id = ?)" : ""} ORDER BY mv.created_at DESC, mv.id DESC LIMIT 2000`, ...(programId ? [user.orgId, programId] : [user.orgId]));
    columns = ["Time", "Community", "Merchant", "Item", "Category", "Change", "Quantity after", "Reason", "Note"];
    rows = r.map((x) => [x.created_at, x.community_name, x.merchant_name, x.item_name, categoryLabel(x.category), x.delta, x.quantity_after, x.reason, x.note]);
  } else {
    if (!programId) throw notFound("Program");
    const snap = await loadSnapshot(db, programId, c.get("now")());
    const ev = analyze(snap).forecastEvaluation;
    columns = ["Scope", "Samples", "Selected model MAE (units/day)", "Baseline MAE (units/day)", "Selected MAPE %", "Baseline MAPE %", "Zero-demand days excluded from MAPE", "Selected beats baseline (MAE)"];
    const fmt = (v: number | null) => (v === null ? "n/a" : (v * 100).toFixed(1));
    rows = [ev.overall, ...ev.byCategory].map((e) => [e.label, e.selected.samples, e.selected.mae.toFixed(2), e.baseline.mae.toFixed(2), fmt(e.selected.mape), fmt(e.baseline.mape), e.selected.samples - e.selected.mapeSamples, e.selectedBeatsBaseline ? "yes" : "no"]);
    note = ev.note;
  }
  if (c.req.query("format") === "csv") {
    return new Response(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="relay-${type}.csv"` } });
  }
  return c.json({ id: type, title: REPORTS[type], columns, rows, note });
});

/* ---------------- Audit log ---------------- */

financeRoutes.get("/audit", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q, 20);
  const where = ["org_id = ?"], params: unknown[] = [user.orgId];
  if (q.programId) { where.push("(program_id = ? OR program_id IS NULL)"); params.push(q.programId); }
  if (q.action && q.action !== "all") { where.push("action LIKE ?"); params.push(`${q.action}%`); }
  if (q.role && q.role !== "all") { where.push("actor_role = ?"); params.push(q.role); }
  if (q.q) { where.push("(action LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\' OR entity_id LIKE ? ESCAPE '\\' OR metadata_json LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"); params.push(...Array(5).fill(likeTerm(q.q))); }
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n FROM audit_logs WHERE ${where.join(" AND ")}`, ...params))!.n;
  const rows = await all<Row>(c.env.DB, `SELECT * FROM audit_logs WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const groups = await all<Row>(c.env.DB, "SELECT DISTINCT substr(action, 1, instr(action, '.') - 1) AS g FROM audit_logs WHERE org_id = ? ORDER BY g", user.orgId);
  return c.json({ total, page, pageSize, groups: groups.map((g) => g.g), items: rows.map((r) => ({ id: r.id, actorName: r.actor_name, actorRole: r.actor_role, action: r.action, entityType: r.entity_type, entityId: r.entity_id, programId: r.program_id, metadata: JSON.parse(r.metadata_json), createdAt: r.created_at })) });
});
