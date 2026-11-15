import { Hono } from "hono";
import type { AppEnv } from "../env";
import { stockStatus } from "../../shared/constants";
import { redeemSchema, terminalBasketSchema } from "../../shared/schemas";
import { all, first, pageOf, type Row } from "../lib/db";
import { HttpError, notFound, parse, readJson, toCsv } from "../lib/http";
import { rateLimited } from "../lib/rateLimit";
import { signVoucher } from "../lib/voucherToken";
import { loadReceipt, redeem, validateTerminal } from "../services/redemption";

export const merchantPortal = new Hono<AppEnv>();
export const residentPortal = new Hono<AppEnv>();

const secretOf = (env: AppEnv["Bindings"]) => {
  if (!env.VOUCHER_SIGNING_SECRET) throw new HttpError(500, "misconfigured", "VOUCHER_SIGNING_SECRET is not configured");
  return env.VOUCHER_SIGNING_SECRET;
};

/* ---------------- Merchant ---------------- */

merchantPortal.get("/me", async (c) => {
  const m = await first<Row>(c.env.DB, "SELECT m.*, c.name AS community_name, p.name AS program_name, p.status AS program_status FROM merchants m JOIN communities c ON c.id = m.community_id LEFT JOIN program_communities pc ON pc.community_id = c.id LEFT JOIN programs p ON p.id = pc.program_id AND p.status = 'active' WHERE m.id = ? LIMIT 1", c.get("user").merchantId);
  if (!m) throw notFound("Merchant");
  return c.json({ merchant: { id: m.id, name: m.name, category: m.category, status: m.status, participating: !!m.participating, communityName: m.community_name, programName: m.program_name } });
});

merchantPortal.get("/dashboard", async (c) => {
  const id = c.get("user").merchantId!;
  const now = c.get("now")();
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const today = await first<Row>(c.env.DB, "SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) cents FROM redemptions WHERE merchant_id = ? AND status = 'completed' AND created_at >= ?", id, since);
  const outstanding = await first<Row>(c.env.DB, "SELECT COALESCE(SUM(amount_cents),0) cents, COUNT(*) n FROM reimbursement_claims WHERE merchant_id = ? AND status IN ('pending','approved')", id);
  const inv = await all<Row>(c.env.DB, "SELECT quantity, min_threshold FROM inventory_items WHERE merchant_id = ?", id);
  const counts = { healthy: 0, low: 0, critical: 0, out_of_stock: 0 } as Record<string, number>;
  for (const i of inv) counts[stockStatus(i.quantity, i.min_threshold)]++;
  const recent = await all<Row>(c.env.DB, "SELECT rd.id, rd.receipt_no, rd.amount_cents, rd.status, rd.created_at, v.public_code FROM redemptions rd JOIN vouchers v ON v.id = rd.voucher_id WHERE rd.merchant_id = ? ORDER BY rd.created_at DESC LIMIT 6", id);
  const daily = await all<Row>(c.env.DB, "SELECT substr(created_at,1,10) AS day, COUNT(*) n, SUM(amount_cents) cents FROM redemptions WHERE merchant_id = ? AND status = 'completed' AND created_at >= ? GROUP BY day ORDER BY day", id, new Date(now.getTime() - 14 * 86_400_000).toISOString());
  return c.json({ last24h: { count: today!.n, cents: today!.cents }, outstanding: { cents: outstanding!.cents, claims: outstanding!.n }, stock: counts, recent: recent.map((r) => ({ id: r.id, receiptNo: r.receipt_no, amountCents: r.amount_cents, status: r.status, createdAt: r.created_at, voucherCode: r.public_code })), daily: daily.map((d) => ({ day: d.day, count: d.n, cents: d.cents })) });
});

merchantPortal.get("/products", async (c) => {
  const rows = await all<Row>(c.env.DB, "SELECT * FROM inventory_items WHERE merchant_id = ? ORDER BY category, name", c.get("user").merchantId);
  return c.json({ items: rows.map((i) => ({ id: i.id, name: i.name, category: i.category, unit: i.unit, unitPriceCents: i.unit_price_cents, quantity: i.quantity, status: stockStatus(i.quantity, i.min_threshold) })) });
});

merchantPortal.post("/terminal/validate", async (c) => {
  const user = c.get("user");
  if (rateLimited(`validate:${user.id}`, 120, 60_000, c.get("now")().getTime())) throw new HttpError(429, "rate_limited", "Too many validation requests. Slow down and retry.");
  const b = parse(terminalBasketSchema, await readJson(c.req.raw));
  return c.json(await validateTerminal(c.env.DB, secretOf(c.env), user.merchantId!, b, c.get("now")()));
});

merchantPortal.post("/terminal/redeem", async (c) => {
  const user = c.get("user");
  if (rateLimited(`redeem:${user.id}`, 60, 60_000, c.get("now")().getTime())) throw new HttpError(429, "rate_limited", "Too many redemption requests. Slow down and retry.");
  const b = parse(redeemSchema, await readJson(c.req.raw));
  const receipt = await redeem(c.env.DB, secretOf(c.env), user, b, c.get("now")());
  return c.json({ receipt }, receipt.duplicate ? 200 : 201);
});

merchantPortal.get("/sales", async (c) => {
  const id = c.get("user").merchantId!;
  const { page, pageSize, offset } = pageOf(c.req.query(), 12);
  const total = (await first<Row>(c.env.DB, "SELECT COUNT(*) n FROM redemptions WHERE merchant_id = ?", id))!.n;
  const rows = await all<Row>(c.env.DB, "SELECT rd.id, rd.receipt_no, rd.amount_cents, rd.status, rd.created_at, rd.claim_id, v.public_code, (SELECT COUNT(*) FROM redemption_items ri WHERE ri.redemption_id = rd.id) AS lines FROM redemptions rd JOIN vouchers v ON v.id = rd.voucher_id WHERE rd.merchant_id = ? ORDER BY rd.created_at DESC LIMIT ? OFFSET ?", id, pageSize, offset);
  if (c.req.query("format") === "csv") {
    const all2 = await all<Row>(c.env.DB, "SELECT rd.receipt_no, rd.amount_cents, rd.status, rd.created_at, rd.claim_id, v.public_code FROM redemptions rd JOIN vouchers v ON v.id = rd.voucher_id WHERE rd.merchant_id = ? ORDER BY rd.created_at DESC", id);
    return new Response(toCsv(["Receipt", "Voucher", "Amount (USD)", "Status", "Claim", "Time"], all2.map((r) => [r.receipt_no, r.public_code, (r.amount_cents / 100).toFixed(2), r.status, r.claim_id, r.created_at])), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="relay-sales-history.csv"' } });
  }
  return c.json({ total, page, pageSize, items: rows.map((r) => ({ id: r.id, receiptNo: r.receipt_no, amountCents: r.amount_cents, status: r.status, createdAt: r.created_at, claimId: r.claim_id, voucherCode: r.public_code, lines: r.lines })) });
});

merchantPortal.get("/sales/:id", async (c) => {
  const r = await first<Row>(c.env.DB, "SELECT id FROM redemptions WHERE id = ? AND merchant_id = ?", c.req.param("id"), c.get("user").merchantId);
  if (!r) throw notFound("Sale");
  return c.json({ receipt: await loadReceipt(c.env.DB, r.id) });
});

merchantPortal.get("/reimbursements", async (c) => {
  const id = c.get("user").merchantId!;
  const claims = await all<Row>(c.env.DB, "SELECT cl.*, p.name AS program_name FROM reimbursement_claims cl JOIN programs p ON p.id = cl.program_id WHERE cl.merchant_id = ? ORDER BY cl.created_at DESC", id);
  const totals = await all<Row>(c.env.DB, "SELECT status, COUNT(*) n, COALESCE(SUM(amount_cents),0) cents FROM reimbursement_claims WHERE merchant_id = ? GROUP BY status", id);
  if (c.req.query("format") === "csv") {
    const items = await all<Row>(c.env.DB, "SELECT ri.claim_id, cl.status, rd.receipt_no, rd.created_at, ri.amount_cents, ri.voided FROM reimbursement_items ri JOIN reimbursement_claims cl ON cl.id = ri.claim_id JOIN redemptions rd ON rd.id = ri.redemption_id WHERE cl.merchant_id = ? ORDER BY rd.created_at", id);
    return new Response(toCsv(["Claim", "Claim status", "Transaction", "Time", "Amount (USD)", "Voided"], items.map((i) => [i.claim_id, i.status, i.receipt_no, i.created_at, (i.amount_cents / 100).toFixed(2), i.voided ? "yes" : "no"])), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="relay-reimbursement-statement.csv"' } });
  }
  return c.json({ totals: Object.fromEntries(totals.map((t) => [t.status, { count: t.n, cents: t.cents }])), items: claims.map((x) => ({ id: x.id, programName: x.program_name, amountCents: x.amount_cents, itemCount: x.item_count, status: x.status, createdAt: x.created_at, decidedAt: x.decided_at, rejectionReason: x.rejection_reason })) });
});

merchantPortal.get("/reimbursements/:id", async (c) => {
  const cl = await first<Row>(c.env.DB, "SELECT * FROM reimbursement_claims WHERE id = ? AND merchant_id = ?", c.req.param("id"), c.get("user").merchantId);
  if (!cl) throw notFound("Claim");
  const items = await all<Row>(c.env.DB, "SELECT ri.amount_cents, ri.voided, rd.receipt_no, rd.created_at, rd.id AS redemption_id FROM reimbursement_items ri JOIN redemptions rd ON rd.id = ri.redemption_id WHERE ri.claim_id = ? ORDER BY rd.created_at", cl.id);
  return c.json({ claim: { id: cl.id, status: cl.status, amountCents: cl.amount_cents, createdAt: cl.created_at, decidedAt: cl.decided_at, rejectionReason: cl.rejection_reason }, items: items.map((i) => ({ redemptionId: i.redemption_id, receiptNo: i.receipt_no, createdAt: i.created_at, amountCents: i.amount_cents, voided: !!i.voided })) });
});

/* ---------------- Resident ---------------- */

async function residentOf(c: { env: AppEnv["Bindings"]; get: (k: "user") => AppEnv["Variables"]["user"] }) {
  const r = await first<Row>(c.env.DB, `SELECT r.*, com.name AS community_name, p.name AS program_name, p.status AS program_status, p.end_date, p.restrict_home_community, p.categories_json FROM residents r JOIN communities com ON com.id = r.community_id JOIN programs p ON p.id = r.program_id WHERE r.id = ?`, c.get("user").residentId);
  if (!r) throw notFound("Resident");
  return r;
}

residentPortal.get("/summary", async (c) => {
  const r = await residentOf(c);
  const now = c.get("now")().toISOString();
  const bal = await first<Row>(c.env.DB, "SELECT COALESCE(SUM(amount_cents),0) AS n FROM ledger_entries WHERE resident_id = ? AND account_type = 'resident'", r.id);
  const active = await first<Row>(c.env.DB, "SELECT COUNT(*) n, MIN(expires_at) soonest FROM vouchers WHERE resident_id = ? AND status = 'active' AND remaining_cents > 0 AND expires_at > ?", r.id, now);
  const totals = await first<Row>(c.env.DB, "SELECT COALESCE(SUM(CASE WHEN entry_type = 'assistance_issued' THEN amount_cents END),0) AS issued, COALESCE(-SUM(CASE WHEN entry_type IN ('voucher_redeemed','voucher_reversal') THEN amount_cents END),0) AS redeemed FROM ledger_entries WHERE resident_id = ?", r.id);
  const recent = await all<Row>(c.env.DB, "SELECT l.id, l.entry_type, l.amount_cents, l.memo, l.created_at FROM ledger_entries l WHERE l.resident_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 5", r.id);
  return c.json({ resident: { id: r.id, name: r.name, communityName: r.community_name, status: r.status }, program: { name: r.program_name, status: r.program_status, endDate: r.end_date, restrictHomeCommunity: !!r.restrict_home_community }, balanceCents: bal!.n, activeVouchers: active!.n, nextExpiry: active!.soonest, issuedCents: totals!.issued, redeemedCents: totals!.redeemed, recent: recent.map((x) => ({ id: x.id, type: x.entry_type, amountCents: x.amount_cents, memo: x.memo, createdAt: x.created_at })) });
});

residentPortal.get("/vouchers", async (c) => {
  const r = await residentOf(c);
  const secret = secretOf(c.env);
  const now = c.get("now")().toISOString();
  const rows = await all<Row>(c.env.DB, "SELECT * FROM vouchers WHERE resident_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, issued_at DESC", r.id);
  // Only the signed credential leaves the server; it carries no resident data and no secret.
  const items = await Promise.all(rows.map(async (v) => {
    const expired = v.expires_at <= now;
    const status = v.status === "cancelled" ? "cancelled" : v.remaining_cents <= 0 ? "exhausted" : expired ? "expired" : "active";
    return { id: v.id, code: v.public_code, token: status === "active" ? await signVoucher(secret, v.public_code, v.nonce) : null, amountCents: v.amount_cents, remainingCents: v.remaining_cents, eligibleCategories: JSON.parse(v.eligible_categories_json), status, issuedAt: v.issued_at, expiresAt: v.expires_at };
  }));
  return c.json({ items });
});

residentPortal.get("/merchants", async (c) => {
  const r = await residentOf(c);
  const rows = await all<Row>(c.env.DB, `SELECT m.*, com.name AS community_name FROM merchants m JOIN communities com ON com.id = m.community_id JOIN program_communities pc ON pc.community_id = m.community_id WHERE pc.program_id = ? AND m.participating = 1 ORDER BY (m.community_id = ?) DESC, m.name`, r.program_id, r.community_id);
  const inv = await all<Row>(c.env.DB, "SELECT merchant_id, category, SUM(quantity) q FROM inventory_items WHERE quantity > 0 GROUP BY merchant_id, category");
  const byM = new Map<string, string[]>();
  for (const i of inv) (byM.get(i.merchant_id) ?? byM.set(i.merchant_id, []).get(i.merchant_id)!).push(i.category);
  return c.json({ items: rows.map((m) => ({ id: m.id, name: m.name, category: m.category, status: m.status, communityName: m.community_name, home: m.community_id === r.community_id, usable: !r.restrict_home_community || m.community_id === r.community_id, availableCategories: m.status === "closed" ? [] : byM.get(m.id) ?? [] })), restrictHomeCommunity: !!r.restrict_home_community });
});

residentPortal.get("/activity", async (c) => {
  const r = await residentOf(c);
  const { page, pageSize, offset } = pageOf(c.req.query(), 15);
  const total = (await first<Row>(c.env.DB, "SELECT COUNT(*) n FROM ledger_entries WHERE resident_id = ?", r.id))!.n;
  const rows = await all<Row>(c.env.DB, `SELECT l.id, l.entry_type, l.amount_cents, l.memo, l.created_at, l.redemption_id, rd.receipt_no, m.name AS merchant_name, v.public_code FROM ledger_entries l LEFT JOIN redemptions rd ON rd.id = l.redemption_id LEFT JOIN merchants m ON m.id = rd.merchant_id LEFT JOIN vouchers v ON v.id = l.voucher_id WHERE l.resident_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`, r.id, pageSize, offset);
  return c.json({ total, page, pageSize, items: rows.map((x) => ({ id: x.id, type: x.entry_type, amountCents: x.amount_cents, memo: x.memo, createdAt: x.created_at, receiptNo: x.receipt_no, merchantName: x.merchant_name, voucherCode: x.public_code })) });
});
