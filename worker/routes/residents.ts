import { Hono } from "hono";
import type { AppEnv } from "../env";
import { issueAssistanceSchema, residentCreateSchema } from "../../shared/schemas";
import { all, auditStmt, first, likeTerm, pageOf, type Row } from "../lib/db";
import { shortId } from "../lib/crypto";
import { conflict, notFound, parse, readJson } from "../lib/http";

export const residentRoutes = new Hono<AppEnv>();

const BALANCE_SQL = `
  SELECT r.id, r.name, r.household_size, r.status, r.community_id, r.program_id, c.name AS community_name, p.name AS program_name, p.end_date,
    COALESCE((SELECT SUM(l.amount_cents) FROM ledger_entries l WHERE l.resident_id = r.id AND l.account_type = 'resident'), 0) AS balance_cents,
    COALESCE((SELECT SUM(l.amount_cents) FROM ledger_entries l WHERE l.resident_id = r.id AND l.entry_type = 'assistance_issued'), 0) AS issued_cents,
    COALESCE(-(SELECT SUM(l.amount_cents) FROM ledger_entries l WHERE l.resident_id = r.id AND l.entry_type IN ('voucher_redeemed','voucher_reversal')), 0) AS redeemed_cents
  FROM residents r JOIN communities c ON c.id = r.community_id JOIN programs p ON p.id = r.program_id`;

const dto = (r: Row) => ({ id: r.id, name: r.name, householdSize: r.household_size, status: r.status, communityId: r.community_id, communityName: r.community_name, programId: r.program_id, programName: r.program_name, balanceCents: r.balance_cents, issuedCents: r.issued_cents, redeemedCents: r.redeemed_cents });

residentRoutes.get("/", async (c) => {
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q);
  const where = ["r.org_id = ?"], params: unknown[] = [c.get("user").orgId];
  if (q.q) { where.push("(r.name LIKE ? ESCAPE '\\' OR r.id LIKE ? ESCAPE '\\')"); params.push(likeTerm(q.q), likeTerm(q.q)); }
  if (q.communityId) { where.push("r.community_id = ?"); params.push(q.communityId); }
  if (q.programId) { where.push("r.program_id = ?"); params.push(q.programId); }
  if (q.status && q.status !== "all") { where.push("r.status = ?"); params.push(q.status); }
  const sorts: Record<string, string> = { name: "r.name", id: "r.id", balance: "balance_cents", issued: "issued_cents", redeemed: "redeemed_cents", community: "c.name" };
  const sort = sorts[q.sort ?? ""] ?? "r.id";
  const dir = q.dir === "desc" ? "DESC" : "ASC";
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n FROM residents r WHERE ${where.join(" AND ")}`, ...params))!.n;
  const rows = await all<Row>(c.env.DB, `${BALANCE_SQL} WHERE ${where.join(" AND ")} ORDER BY ${sort} ${dir}, r.id LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  return c.json({ items: rows.map(dto), total, page, pageSize });
});

residentRoutes.post("/", async (c) => {
  const user = c.get("user");
  const b = parse(residentCreateSchema, await readJson(c.req.raw));
  const link = await first<Row>(c.env.DB, "SELECT p.status FROM programs p JOIN program_communities pc ON pc.program_id = p.id WHERE p.id = ? AND p.org_id = ? AND pc.community_id = ?", b.programId, user.orgId, b.communityId);
  if (!link) throw conflict("That community does not participate in the selected program.", "community_not_in_program");
  if (link.status === "closed") throw conflict("Residents cannot be added to a closed program.", "program_closed");
  const next = ((await first<Row>(c.env.DB, "SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) n FROM residents"))?.n ?? 1000) + 1;
  const id = `RES-${next}`;
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO residents (id, org_id, community_id, program_id, name, household_size, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)").bind(id, user.orgId, b.communityId, b.programId, b.name, b.householdSize, now),
    c.env.DB.prepare("INSERT INTO users (id, org_id, role, name, email, resident_id, active, created_at) VALUES (?, ?, 'resident', ?, ?, ?, 1, ?)").bind(`usr_res_${id.slice(4)}`, user.orgId, b.name, `${id.toLowerCase()}@relay.demo`, id, now),
    auditStmt(c.env.DB, user, "resident.registered", "resident", id, b.programId, { community: b.communityId }, now),
  ]);
  return c.json({ resident: dto((await first<Row>(c.env.DB, `${BALANCE_SQL} WHERE r.id = ?`, id))!) }, 201);
});

residentRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const r = await first<Row>(c.env.DB, `${BALANCE_SQL} WHERE r.id = ? AND r.org_id = ?`, id, c.get("user").orgId);
  if (!r) throw notFound("Resident");
  const vouchers = await all<Row>(c.env.DB, "SELECT * FROM vouchers WHERE resident_id = ? ORDER BY issued_at DESC", id);
  const reds = await all<Row>(c.env.DB, `SELECT rd.id, rd.receipt_no, rd.amount_cents, rd.status, rd.created_at, m.name AS merchant_name, v.public_code FROM redemptions rd JOIN merchants m ON m.id = rd.merchant_id JOIN vouchers v ON v.id = rd.voucher_id WHERE rd.resident_id = ? ORDER BY rd.created_at DESC LIMIT 25`, id);
  const alloc = await all<Row>(c.env.DB, `SELECT a.id, a.status, a.created_at, ar.recommended_cents, ar.voucher_pct FROM allocation_recommendations ar JOIN allocation_runs a ON a.id = ar.run_id WHERE a.program_id = ? AND ar.community_id = ? ORDER BY a.created_at DESC LIMIT 5`, r.program_id, r.community_id);
  const nowIso = c.get("now")().toISOString();
  return c.json({
    resident: dto(r), programEndDate: r.end_date,
    vouchers: vouchers.map((v) => ({ id: v.id, code: v.public_code, amountCents: v.amount_cents, remainingCents: v.remaining_cents, eligibleCategories: JSON.parse(v.eligible_categories_json), status: v.status === "active" && v.expires_at <= nowIso ? "expired" : v.status, issuedAt: v.issued_at, expiresAt: v.expires_at })),
    redemptions: reds.map((x) => ({ id: x.id, receiptNo: x.receipt_no, amountCents: x.amount_cents, status: x.status, createdAt: x.created_at, merchantName: x.merchant_name, voucherCode: x.public_code })),
    allocations: alloc.map((a) => ({ runId: a.id, status: a.status, createdAt: a.created_at, communityRecommendedCents: a.recommended_cents, voucherPct: a.voucher_pct })),
  });
});

/** Issue assistance as a voucher: voucher row + ledger entry + audit, all in one atomic batch. */
residentRoutes.post("/:id/vouchers", async (c) => {
  const user = c.get("user");
  const b = parse(issueAssistanceSchema, await readJson(c.req.raw));
  const res = await first<Row>(c.env.DB, "SELECT r.*, p.status AS program_status, p.budget_cents, p.end_date, p.categories_json FROM residents r JOIN programs p ON p.id = r.program_id WHERE r.id = ? AND r.org_id = ?", c.req.param("id"), user.orgId);
  if (!res) throw notFound("Resident");
  if (res.status !== "active") throw conflict("Assistance cannot be issued to a suspended resident.", "resident_suspended");
  if (res.program_status !== "active") throw conflict("Assistance can only be issued under an active program.", "program_inactive");
  const allowed: string[] = JSON.parse(res.categories_json);
  const bad = b.eligibleCategories.filter((x) => !allowed.includes(x));
  if (bad.length) throw conflict(`Categories not enabled for this program: ${bad.join(", ")}.`, "category_not_in_program");
  const issued = (await first<Row>(c.env.DB, "SELECT COALESCE(SUM(amount_cents),0) n FROM vouchers WHERE program_id = ? AND status != 'cancelled'", res.program_id))!.n;
  if (issued + b.amountCents > res.budget_cents) throw conflict(`Issuing this amount would exceed the program budget (remaining: $${((res.budget_cents - issued) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}).`, "budget_exceeded");
  const now = c.get("now")();
  const defaultExpiry = new Date(Math.min(now.getTime() + 30 * 86_400_000, Date.parse(res.end_date + "T23:59:59Z")));
  const expiresAt = b.expiresAt ? `${b.expiresAt}T23:59:59.000Z` : defaultExpiry.toISOString();
  if (expiresAt <= now.toISOString()) throw conflict("Expiration must be in the future.", "invalid_expiry");
  const id = shortId("vch");
  const code = `VCH-${id.slice(4, 10).toUpperCase().replace(/[IOLU]/g, "7")}`;
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const nowIso = now.toISOString();
  const guard = shortId("g");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO vouchers (id, public_code, program_id, resident_id, amount_cents, remaining_cents, eligible_categories_json, status, nonce, version, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)").bind(id, code, res.program_id, res.id, b.amountCents, b.amountCents, JSON.stringify(b.eligibleCategories), nonce, nowIso, expiresAt),
    // Re-check the budget inside the batch so two concurrent issuances cannot jointly exceed it.
    c.env.DB.prepare("INSERT INTO tx_guards (id, ok) SELECT ?, CASE WHEN (SELECT COALESCE(SUM(amount_cents),0) FROM vouchers WHERE program_id = ? AND status != 'cancelled') <= ? THEN 1 ELSE 0 END").bind(guard, res.program_id, res.budget_cents),
    c.env.DB.prepare("INSERT INTO ledger_entries (id, program_id, account_type, resident_id, voucher_id, entry_type, amount_cents, memo, created_by, created_at) VALUES (?, ?, 'resident', ?, ?, 'assistance_issued', ?, ?, ?, ?)").bind(`${id}_led`, res.program_id, res.id, id, b.amountCents, `Assistance issued ${code}`, user.id, nowIso),
    auditStmt(c.env.DB, user, "voucher.issued", "voucher", id, res.program_id, { code, resident: res.id, amountCents: b.amountCents, categories: b.eligibleCategories, expiresAt }, nowIso),
    c.env.DB.prepare("DELETE FROM tx_guards WHERE id = ?").bind(guard),
  ]).catch(() => { throw conflict("The program budget changed while issuing. Please retry.", "concurrent_update"); });
  return c.json({ voucher: { id, code, amountCents: b.amountCents, expiresAt } }, 201);
});
