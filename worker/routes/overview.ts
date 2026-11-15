import { Hono } from "hono";
import type { AppEnv } from "../env";
import { analyze } from "../../shared/engine";
import { all, first, likeTerm, pageOf, type Row } from "../lib/db";
import { intParam, notFound, parse, readJson } from "../lib/http";
import { reverseSchema } from "../../shared/schemas";
import { loadReceipt, reverseRedemption } from "../services/redemption";
import { buildAlerts } from "../services/alerts";
import { loadSnapshot } from "../services/snapshot";
import { getProgram } from "../services/stats";

export const overviewRoutes = new Hono<AppEnv>();
const DAY = 86_400_000;

overviewRoutes.get("/overview", async (c) => {
  const user = c.get("user");
  const programId = c.req.query("programId");
  if (!programId) throw notFound("Program");
  const program = await getProgram(c.env.DB, user.orgId, programId);
  if (!program) throw notFound("Program");
  const days = intParam(c.req.query("days"), 30, 7, 30) === 7 ? 7 : 30;
  const now = c.get("now")();
  const db = c.env.DB;

  const snapshot = await loadSnapshot(db, programId, now);
  const analysis = analyze(snapshot);
  const names = Object.fromEntries(snapshot.communities.map((x) => [x.id, x.name]));
  const alerts = await buildAlerts(db, analysis, program, names);

  const since = new Date(now.getTime() - (days - 1) * DAY);
  const startDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const red = await all<Row>(db, `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n, SUM(amount_cents) AS cents FROM redemptions WHERE program_id = ? AND status = 'completed' AND created_at >= ? GROUP BY day`, programId, startDay.toISOString());
  const iss = await all<Row>(db, `SELECT substr(issued_at,1,10) AS day, SUM(amount_cents) AS cents FROM vouchers WHERE program_id = ? AND status != 'cancelled' AND issued_at >= ? GROUP BY day`, programId, startDay.toISOString());
  const rMap = new Map(red.map((r) => [r.day, r])), iMap = new Map(iss.map((r) => [r.day, r.cents]));
  const series = Array.from({ length: days }, (_, k) => {
    const d = new Date(startDay.getTime() + k * DAY).toISOString().slice(0, 10);
    return { day: d, redeemedCents: rMap.get(d)?.cents ?? 0, redemptions: rMap.get(d)?.n ?? 0, issuedCents: iMap.get(d) ?? 0 };
  });

  const d7 = new Date(now.getTime() - 7 * DAY).toISOString(), d14 = new Date(now.getTime() - 14 * DAY).toISOString();
  const sum = async (sql: string, ...p: unknown[]) => (await first<Row>(db, sql, ...p))?.n ?? 0;
  const redLast = await sum("SELECT COALESCE(SUM(amount_cents),0) n FROM redemptions WHERE program_id = ? AND status = 'completed' AND created_at >= ?", programId, d7);
  const redPrev = await sum("SELECT COALESCE(SUM(amount_cents),0) n FROM redemptions WHERE program_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?", programId, d14, d7);
  const issLast = await sum("SELECT COALESCE(SUM(amount_cents),0) n FROM vouchers WHERE program_id = ? AND status != 'cancelled' AND issued_at >= ?", programId, d7);
  const claimNet = await sum("SELECT COALESCE(SUM(amount_cents),0) n FROM ledger_entries WHERE program_id = ? AND account_type = 'merchant' AND created_at >= ?", programId, d7);

  const recent = await all<Row>(db, `SELECT rd.id, rd.receipt_no, rd.amount_cents, rd.status, rd.created_at, m.name AS merchant_name, cm.name AS community_name, r.name AS resident_name, rd.resident_id FROM redemptions rd JOIN merchants m ON m.id = rd.merchant_id JOIN communities cm ON cm.id = m.community_id JOIN residents r ON r.id = rd.resident_id WHERE rd.program_id = ? ORDER BY rd.created_at DESC LIMIT 8`, programId);
  const latest = await first<Row>(db, "SELECT * FROM allocation_runs WHERE program_id = ? AND status != 'superseded' ORDER BY created_at DESC LIMIT 1", programId);
  const latestRecs = latest ? await all<Row>(db, "SELECT ar.*, c.name AS community_name FROM allocation_recommendations ar JOIN communities c ON c.id = ar.community_id WHERE ar.run_id = ? ORDER BY ar.recommended_cents DESC", latest.id) : [];

  return c.json({
    program, days, asOf: now.toISOString(),
    kpis: {
      budgetCents: program.budgetCents, allocatedCents: program.allocatedCents, issuedCents: program.issuedCents, redeemedCents: program.redeemedCents, outstandingClaimsCents: program.outstandingClaimsCents,
      trends: { redeemed: { last7Cents: redLast, prev7Cents: redPrev }, issued: { last7Cents: issLast }, claims: { netLast7Cents: claimNet } },
    },
    communities: analysis.communities.map((x) => ({ communityId: x.communityId, name: x.name, populationNeeding: x.populationNeeding, marketViability: x.marketViability, inventoryCoverage: x.inventoryCoverage, needSeverity: x.needSeverity, merchantCoverage: x.merchantCoverage, voucherPct: x.voucherPct, directPct: x.directPct, voucherCents: x.voucherCents, directCents: x.directCents, risk: x.risk, merchantCapacity: x.merchantCapacity, marketAccess: x.marketAccess, operatingMerchants: x.operatingMerchants, participatingMerchants: x.participatingMerchants, action: x.action, actionLabel: x.actionLabel, topGap: x.topGaps[0] ?? null, diagramX: snapshot.communities.find((s) => s.id === x.communityId)?.diagramX ?? 50, diagramY: snapshot.communities.find((s) => s.id === x.communityId)?.diagramY ?? 50 })),
    alerts, series,
    recentTransactions: recent.map((r) => ({ id: r.id, receiptNo: r.receipt_no, amountCents: r.amount_cents, status: r.status, createdAt: r.created_at, merchantName: r.merchant_name, communityName: r.community_name, residentName: r.resident_name, residentId: r.resident_id })),
    latestAllocation: latest ? { id: latest.id, status: latest.status, createdAt: latest.created_at, totalCents: latest.total_recommended_cents, recommendations: latestRecs.map((r) => ({ communityId: r.community_id, communityName: r.community_name, recommendedCents: r.recommended_cents, voucherPct: r.voucher_pct, directPct: r.direct_pct, viability: r.market_viability })) } : null,
  });
});

/** Ledger transactions (coordinator). */
overviewRoutes.get("/transactions", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q, 15);
  const where = ["p.org_id = ?"], params: unknown[] = [user.orgId];
  if (q.programId) { where.push("l.program_id = ?"); params.push(q.programId); }
  if (q.type && q.type !== "all") { where.push("l.entry_type = ?"); params.push(q.type); }
  if (q.merchantId) { where.push("l.merchant_id = ?"); params.push(q.merchantId); }
  if (q.residentId) { where.push("l.resident_id = ?"); params.push(q.residentId); }
  if (q.from) { where.push("l.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("l.created_at <= ?"); params.push(`${q.to}T23:59:59.999Z`); }
  if (q.q) { where.push("(l.memo LIKE ? ESCAPE '\\' OR l.id LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\')"); params.push(likeTerm(q.q), likeTerm(q.q), likeTerm(q.q), likeTerm(q.q)); }
  const from = `FROM ledger_entries l JOIN programs p ON p.id = l.program_id LEFT JOIN residents r ON r.id = l.resident_id LEFT JOIN merchants m ON m.id = l.merchant_id LEFT JOIN vouchers v ON v.id = l.voucher_id WHERE ${where.join(" AND ")}`;
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n ${from}`, ...params))!.n;
  const rows = await all<Row>(c.env.DB, `SELECT l.*, r.name AS resident_name, m.name AS merchant_name, v.public_code ${from} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const types = await all<Row>(c.env.DB, `SELECT l.entry_type, COUNT(*) n, SUM(l.amount_cents) cents ${from} GROUP BY l.entry_type`, ...params);
  return c.json({
    total, page, pageSize,
    summary: Object.fromEntries(types.map((t) => [t.entry_type, { count: t.n, cents: t.cents }])),
    items: rows.map((r) => ({ id: r.id, type: r.entry_type, accountType: r.account_type, amountCents: r.amount_cents, memo: r.memo, createdAt: r.created_at, residentId: r.resident_id, residentName: r.resident_name, merchantId: r.merchant_id, merchantName: r.merchant_name, voucherCode: r.public_code, redemptionId: r.redemption_id, reversesEntryId: r.reverses_entry_id })),
  });
});

overviewRoutes.get("/transactions/redemptions/:id", async (c) => {
  const user = c.get("user");
  const r = await first<Row>(c.env.DB, `SELECT rd.*, p.org_id, cl.status AS claim_status, res.name AS resident_name FROM redemptions rd JOIN programs p ON p.id = rd.program_id JOIN reimbursement_claims cl ON cl.id = rd.claim_id JOIN residents res ON res.id = rd.resident_id WHERE rd.id = ?`, c.req.param("id"));
  if (!r || r.org_id !== user.orgId) throw notFound("Redemption");
  const receipt = await loadReceipt(c.env.DB, r.id);
  return c.json({ receipt, residentName: r.resident_name, residentId: r.resident_id, claimStatus: r.claim_status, reversedAt: r.reversed_at, reversalReason: r.reversal_reason, canReverse: r.status === "completed" && r.claim_status === "pending" });
});

overviewRoutes.post("/transactions/redemptions/:id/reverse", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const r = await first<Row>(c.env.DB, "SELECT p.org_id FROM redemptions rd JOIN programs p ON p.id = rd.program_id WHERE rd.id = ?", id);
  if (!r || r.org_id !== user.orgId) throw notFound("Redemption");
  const b = parse(reverseSchema, await readJson(c.req.raw));
  return c.json({ receipt: await reverseRedemption(c.env.DB, user, id, b.reason, c.get("now")()) });
});
