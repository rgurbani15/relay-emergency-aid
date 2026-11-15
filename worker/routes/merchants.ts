import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ENGINE, stockStatus } from "../../shared/constants";
import { merchantCreateSchema, merchantUpdateSchema } from "../../shared/schemas";
import { all, auditStmt, first, likeTerm, pageOf, type Row } from "../lib/db";
import { shortId } from "../lib/crypto";
import { notFound, parse, readJson, badRequest } from "../lib/http";

export const merchantRoutes = new Hono<AppEnv>();

const LIST_SQL = `
  SELECT m.*, c.name AS community_name,
    COALESCE((SELECT SUM(cl.amount_cents) FROM reimbursement_claims cl WHERE cl.merchant_id = m.id AND cl.status IN ('pending','approved')),0) AS outstanding_cents,
    (SELECT COUNT(*) FROM redemptions r WHERE r.merchant_id = m.id AND r.status = 'completed') AS redemption_count,
    (SELECT COUNT(*) FROM inventory_items i WHERE i.merchant_id = m.id) AS item_count,
    (SELECT COUNT(*) FROM inventory_items i WHERE i.merchant_id = m.id AND i.quantity > i.min_threshold) AS healthy_count
  FROM merchants m JOIN communities c ON c.id = m.community_id`;

const dto = (m: Row) => ({
  id: m.id, name: m.name, category: m.category, status: m.status, participating: !!m.participating, capacityScore: m.capacity_score,
  communityId: m.community_id, communityName: m.community_name, outstandingCents: m.outstanding_cents, redemptionCount: m.redemption_count,
  inventorySufficiency: m.item_count ? m.healthy_count / m.item_count : 0, effectiveCapacity: m.participating ? Math.round(m.capacity_score * (ENGINE.merchantStatusFactor[m.status] ?? 0)) : 0,
});

merchantRoutes.get("/", async (c) => {
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q, 12);
  const where = ["m.org_id = ?"], params: unknown[] = [c.get("user").orgId];
  if (q.q) { where.push("(m.name LIKE ? ESCAPE '\\' OR m.id LIKE ? ESCAPE '\\')"); params.push(likeTerm(q.q), likeTerm(q.q)); }
  if (q.communityId) { where.push("m.community_id = ?"); params.push(q.communityId); }
  if (q.status && q.status !== "all") { where.push("m.status = ?"); params.push(q.status); }
  if (q.participating === "1" || q.participating === "0") { where.push("m.participating = ?"); params.push(Number(q.participating)); }
  const sorts: Record<string, string> = { name: "m.name", capacity: "m.capacity_score", outstanding: "outstanding_cents", redemptions: "redemption_count", community: "c.name" };
  const sort = sorts[q.sort ?? ""] ?? "m.id";
  const dir = q.dir === "desc" ? "DESC" : "ASC";
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n FROM merchants m WHERE ${where.join(" AND ")}`, ...params))!.n;
  const rows = await all<Row>(c.env.DB, `${LIST_SQL} WHERE ${where.join(" AND ")} ORDER BY ${sort} ${dir}, m.id LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  return c.json({ items: rows.map(dto), total, page, pageSize });
});

merchantRoutes.post("/", async (c) => {
  const user = c.get("user");
  const b = parse(merchantCreateSchema, await readJson(c.req.raw));
  if (!(await first(c.env.DB, "SELECT id FROM communities WHERE id = ? AND org_id = ?", b.communityId, user.orgId))) throw badRequest("Unknown community");
  const next = ((await first<Row>(c.env.DB, "SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) n FROM merchants"))?.n ?? 1000) + 1;
  const id = `MER-${next}`;
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO merchants (id, org_id, community_id, name, category, status, participating, capacity_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)").bind(id, user.orgId, b.communityId, b.name, b.category, b.status, b.capacityScore, now, now),
    c.env.DB.prepare("INSERT INTO users (id, org_id, role, name, email, merchant_id, active, created_at) VALUES (?, ?, 'merchant', ?, ?, ?, 1, ?)").bind(`usr_mer_${id.slice(4)}`, user.orgId, `${b.name} manager`, `${id.toLowerCase()}@relay.demo`, id, now),
    auditStmt(c.env.DB, user, "merchant.registered", "merchant", id, null, { name: b.name, community: b.communityId }, now),
  ]);
  return c.json({ merchant: dto((await first<Row>(c.env.DB, `${LIST_SQL} WHERE m.id = ?`, id))!) }, 201);
});

merchantRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const m = await first<Row>(c.env.DB, `${LIST_SQL} WHERE m.id = ? AND m.org_id = ?`, id, c.get("user").orgId);
  if (!m) throw notFound("Merchant");
  const inventory = await all<Row>(c.env.DB, "SELECT * FROM inventory_items WHERE merchant_id = ? ORDER BY category, name", id);
  const reds = await all<Row>(c.env.DB, `SELECT rd.id, rd.receipt_no, rd.amount_cents, rd.status, rd.created_at, rd.claim_id, v.public_code FROM redemptions rd JOIN vouchers v ON v.id = rd.voucher_id WHERE rd.merchant_id = ? ORDER BY rd.created_at DESC LIMIT 50`, id);
  const claims = await all<Row>(c.env.DB, "SELECT * FROM reimbursement_claims WHERE merchant_id = ? ORDER BY created_at DESC", id);
  const perf = await all<Row>(c.env.DB, `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n, SUM(amount_cents) AS cents FROM redemptions WHERE merchant_id = ? AND status = 'completed' GROUP BY day ORDER BY day`, id);
  return c.json({
    merchant: dto(m),
    inventory: inventory.map((i) => ({ id: i.id, name: i.name, category: i.category, quantity: i.quantity, unit: i.unit, unitPriceCents: i.unit_price_cents, minThreshold: i.min_threshold, status: stockStatus(i.quantity, i.min_threshold), updatedAt: i.updated_at })),
    transactions: reds.map((r) => ({ id: r.id, receiptNo: r.receipt_no, amountCents: r.amount_cents, status: r.status, createdAt: r.created_at, claimId: r.claim_id, voucherCode: r.public_code })),
    claims: claims.map((x) => ({ id: x.id, amountCents: x.amount_cents, itemCount: x.item_count, status: x.status, createdAt: x.created_at, decidedAt: x.decided_at, rejectionReason: x.rejection_reason })),
    performance: perf.map((p) => ({ day: p.day, redemptions: p.n, valueCents: p.cents })),
  });
});

merchantRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const m = await first<Row>(c.env.DB, "SELECT * FROM merchants WHERE id = ? AND org_id = ?", c.req.param("id"), user.orgId);
  if (!m) throw notFound("Merchant");
  const b = parse(merchantUpdateSchema, await readJson(c.req.raw));
  if (b.communityId && !(await first(c.env.DB, "SELECT id FROM communities WHERE id = ? AND org_id = ?", b.communityId, user.orgId))) throw badRequest("Unknown community");
  const now = c.get("now")().toISOString();
  const stmts = [
    c.env.DB.prepare(
      `UPDATE merchants SET name = COALESCE(?, name), category = COALESCE(?, category), status = COALESCE(?, status), participating = COALESCE(?, participating),
       capacity_score = COALESCE(?, capacity_score), community_id = COALESCE(?, community_id), updated_at = ? WHERE id = ?`,
    ).bind(b.name ?? null, b.category ?? null, b.status ?? null, b.participating === undefined ? null : b.participating ? 1 : 0, b.capacityScore ?? null, b.communityId ?? null, now, m.id),
  ];
  // Inventory is community-scoped for the engine, so reassigning a merchant moves its stock records too.
  if (b.communityId && b.communityId !== m.community_id) stmts.push(c.env.DB.prepare("UPDATE inventory_items SET community_id = ? WHERE merchant_id = ?").bind(b.communityId, m.id));
  const action = b.participating !== undefined && !!m.participating !== b.participating ? (b.participating ? "merchant.activated" : "merchant.deactivated") : "merchant.updated";
  stmts.push(auditStmt(c.env.DB, user, action, "merchant", m.id, null, { before: { status: m.status, participating: !!m.participating, capacity: m.capacity_score, community: m.community_id }, changes: b }, now));
  await c.env.DB.batch(stmts);
  return c.json({ merchant: dto((await first<Row>(c.env.DB, `${LIST_SQL} WHERE m.id = ?`, m.id))!) });
});
void shortId;
