import { Hono } from "hono";
import type { AppEnv } from "../env";
import { stockStatus } from "../../shared/constants";
import { inventoryAdjustSchema, inventoryCreateSchema } from "../../shared/schemas";
import { all, auditStmt, first, likeTerm, pageOf, type Row } from "../lib/db";
import { shortId } from "../lib/crypto";
import { conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { stockStatusSql } from "../services/stats";

/** Inventory is shared by coordinators (all merchants) and merchants (own stock only). Scoping is enforced here, server-side. */
export const inventoryRoutes = new Hono<AppEnv>();

const dto = (i: Row) => ({
  id: i.id, merchantId: i.merchant_id, merchantName: i.merchant_name, communityId: i.community_id, communityName: i.community_name, name: i.name, category: i.category,
  quantity: i.quantity, unit: i.unit, unitPriceCents: i.unit_price_cents, minThreshold: i.min_threshold, updatedAt: i.updated_at, status: stockStatus(i.quantity, i.min_threshold),
});
const BASE = `SELECT i.*, m.name AS merchant_name, c.name AS community_name FROM inventory_items i JOIN merchants m ON m.id = i.merchant_id JOIN communities c ON c.id = i.community_id`;

inventoryRoutes.get("/", async (c) => {
  const user = c.get("user");
  if (user.role === "resident") throw forbidden();
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q, 15);
  const where: string[] = [], params: unknown[] = [];
  if (user.role === "merchant") { where.push("i.merchant_id = ?"); params.push(user.merchantId); }
  else { where.push("m.org_id = ?"); params.push(user.orgId); if (q.merchantId) { where.push("i.merchant_id = ?"); params.push(q.merchantId); } }
  if (q.q) { where.push("(i.name LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\')"); params.push(likeTerm(q.q), likeTerm(q.q)); }
  if (q.category && q.category !== "all") { where.push("i.category = ?"); params.push(q.category); }
  if (q.communityId && q.communityId !== "all") { where.push("i.community_id = ?"); params.push(q.communityId); }
  if (q.stock && q.stock !== "all") { where.push(`${stockStatusSql("i")} = ?`); params.push(q.stock); }
  const sorts: Record<string, string> = { name: "i.name", quantity: "i.quantity", price: "i.unit_price_cents", updated: "i.updated_at", merchant: "m.name", category: "i.category" };
  const sort = sorts[q.sort ?? ""] ?? "m.name";
  const dir = q.dir === "desc" ? "DESC" : "ASC";
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n FROM inventory_items i JOIN merchants m ON m.id = i.merchant_id WHERE ${where.join(" AND ")}`, ...params))!.n;
  const rows = await all<Row>(c.env.DB, `${BASE} WHERE ${where.join(" AND ")} ORDER BY ${sort} ${dir}, i.id LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const summary = await all<Row>(c.env.DB, `SELECT ${stockStatusSql("i")} AS s, COUNT(*) n FROM inventory_items i JOIN merchants m ON m.id = i.merchant_id WHERE ${where.join(" AND ")} GROUP BY s`, ...params);
  return c.json({ items: rows.map(dto), total, page, pageSize, summary: Object.fromEntries(summary.map((s) => [s.s, s.n])) });
});

async function scopedItem(c: { env: AppEnv["Bindings"]; get: (k: "user") => AppEnv["Variables"]["user"] }, id: string) {
  const user = c.get("user");
  if (user.role === "resident") throw forbidden();
  const item = await first<Row>(c.env.DB, `${BASE} WHERE i.id = ?`, id);
  // Merchants can only touch their own stock; a foreign id looks identical to a missing one.
  if (!item || (user.role === "merchant" && item.merchant_id !== user.merchantId)) throw notFound("Inventory item");
  if (user.role === "coordinator") {
    const m = await first<Row>(c.env.DB, "SELECT org_id FROM merchants WHERE id = ?", item.merchant_id);
    if (m?.org_id !== user.orgId) throw notFound("Inventory item");
  }
  return item;
}

inventoryRoutes.post("/", async (c) => {
  const user = c.get("user");
  if (user.role === "resident") throw forbidden();
  const b = parse(inventoryCreateSchema, await readJson(c.req.raw));
  const merchantId = user.role === "merchant" ? user.merchantId! : b.merchantId;
  const m = merchantId ? await first<Row>(c.env.DB, "SELECT * FROM merchants WHERE id = ? AND org_id = ?", merchantId, user.orgId) : null;
  if (!m) throw notFound("Merchant");
  const id = shortId("inv");
  const now = c.get("now")().toISOString();
  const stmts = [
    c.env.DB.prepare("INSERT INTO inventory_items (id, merchant_id, community_id, name, category, quantity, unit, unit_price_cents, min_threshold, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, m.id, m.community_id, b.name, b.category, b.quantity, b.unit, b.unitPriceCents, b.minThreshold, now),
    auditStmt(c.env.DB, user, "inventory.created", "inventory_item", id, null, { merchant: m.id, name: b.name, quantity: b.quantity }, now),
  ];
  if (b.quantity > 0) stmts.splice(1, 0, c.env.DB.prepare("INSERT INTO inventory_movements (id, inventory_item_id, merchant_id, community_id, delta, quantity_after, reason, note, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'opening_stock', 'Item added', ?, ?)").bind(`${id}_open`, id, m.id, m.community_id, b.quantity, b.quantity, user.id, now));
  await c.env.DB.batch(stmts);
  return c.json({ item: dto((await first<Row>(c.env.DB, `${BASE} WHERE i.id = ?`, id))!) }, 201);
});

inventoryRoutes.post("/:id/adjust", async (c) => {
  const user = c.get("user");
  const item = await scopedItem(c, c.req.param("id"));
  const b = parse(inventoryAdjustSchema, await readJson(c.req.raw));
  const target = b.mode === "set" ? b.value : item.quantity + b.value;
  if (!Number.isInteger(target) || target < 0) throw conflict("Quantity cannot go below zero.", "negative_inventory");
  const delta = target - item.quantity;
  if (delta === 0) throw conflict("That would not change the quantity.", "no_change");
  const now = c.get("now")().toISOString();
  const guard = shortId("g");
  try {
    await c.env.DB.batch([
      // Compare-and-set on the quantity we read, so a concurrent redemption is never silently overwritten.
      c.env.DB.prepare("UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ? AND quantity = ?").bind(target, now, item.id, item.quantity),
      c.env.DB.prepare("INSERT INTO tx_guards (id, ok) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM inventory_items WHERE id = ? AND quantity = ? AND updated_at = ?) THEN 1 ELSE 0 END").bind(guard, item.id, target, now),
      c.env.DB.prepare("INSERT INTO inventory_movements (id, inventory_item_id, merchant_id, community_id, delta, quantity_after, reason, note, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(shortId("mov"), item.id, item.merchant_id, item.community_id, delta, target, b.reason, b.note ?? null, user.id, now),
      auditStmt(c.env.DB, user, "inventory.adjusted", "inventory_item", item.id, null, { merchant: item.merchant_id, item: item.name, from: item.quantity, to: target, reason: b.reason, note: b.note ?? null }, now),
      c.env.DB.prepare("DELETE FROM tx_guards WHERE id = ?").bind(guard),
    ]);
  } catch {
    throw conflict("Stock changed while you were editing (for example, a sale was processed). Refresh and try again.", "concurrent_update");
  }
  return c.json({ item: dto((await first<Row>(c.env.DB, `${BASE} WHERE i.id = ?`, item.id))!) });
});

inventoryRoutes.get("/:id/movements", async (c) => {
  const item = await scopedItem(c, c.req.param("id"));
  const rows = await all<Row>(c.env.DB, `SELECT mv.*, u.name AS actor_name FROM inventory_movements mv LEFT JOIN users u ON u.id = mv.actor_user_id WHERE mv.inventory_item_id = ? ORDER BY mv.created_at DESC, mv.id DESC LIMIT 50`, item.id);
  return c.json({ item: dto(item), movements: rows.map((r) => ({ id: r.id, delta: r.delta, quantityAfter: r.quantity_after, reason: r.reason, note: r.note, actor: r.actor_name, createdAt: r.created_at })) });
});

/** Stock movement feed across items (coordinator: all; merchant: own). */
inventoryRoutes.get("/movements/feed", async (c) => {
  const user = c.get("user");
  if (user.role === "resident") throw forbidden();
  const { page, pageSize, offset } = pageOf(c.req.query(), 10);
  const scope = user.role === "merchant" ? "mv.merchant_id = ?" : "m.org_id = ?";
  const arg = user.role === "merchant" ? user.merchantId : user.orgId;
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n FROM inventory_movements mv JOIN merchants m ON m.id = mv.merchant_id WHERE ${scope}`, arg))!.n;
  const rows = await all<Row>(c.env.DB, `SELECT mv.*, i.name AS item_name, m.name AS merchant_name FROM inventory_movements mv JOIN inventory_items i ON i.id = mv.inventory_item_id JOIN merchants m ON m.id = mv.merchant_id WHERE ${scope} ORDER BY mv.created_at DESC, mv.id DESC LIMIT ? OFFSET ?`, arg, pageSize, offset);
  return c.json({ total, page, pageSize, items: rows.map((r) => ({ id: r.id, itemName: r.item_name, merchantName: r.merchant_name, delta: r.delta, quantityAfter: r.quantity_after, reason: r.reason, note: r.note, createdAt: r.created_at })) });
});
