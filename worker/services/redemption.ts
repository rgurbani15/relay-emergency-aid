import type { SessionUser } from "../env";
import { stockStatus } from "../../shared/constants";
import { auditStmt, all, first, type Row } from "../lib/db";
import { shortId } from "../lib/crypto";
import { HttpError, conflict } from "../lib/http";
import { parseVoucherToken, signVoucher, verifyVoucherSignature } from "../lib/voucherToken";

export type ValidationCode =
  | "invalid_token" | "invalid_signature" | "voucher_not_found" | "voucher_inactive" | "voucher_expired"
  | "insufficient_balance" | "ineligible_category" | "merchant_not_participating" | "merchant_closed"
  | "program_inactive" | "cross_community" | "insufficient_inventory" | "resident_suspended" | "empty_basket" | "invalid_item";

export interface ValidationIssue { code: ValidationCode; message: string; itemId?: string }
export interface BasketLine { inventoryItemId: string; name: string; category: string; quantity: number; unitPriceCents: number; lineTotalCents: number; available: number }

export interface TerminalValidation {
  ok: boolean;
  /** Voucher-level checks only (signature, expiry, program, merchant). True means the voucher itself is usable. */
  voucherValid: boolean;
  issues: ValidationIssue[];
  voucher: null | { code: string; remainingCents: number; amountCents: number; expiresAt: string; eligibleCategories: string[]; residentLabel: string };
  basket: { lines: BasketLine[]; totalCents: number };
  balanceAfterCents: number | null;
}

const msg: Record<ValidationCode, string> = {
  invalid_token: "This does not look like a RELAY voucher code.",
  invalid_signature: "Invalid signature: this voucher credential could not be verified.",
  voucher_not_found: "Voucher not found.",
  voucher_inactive: "This voucher has been cancelled and cannot be used.",
  voucher_expired: "This voucher has expired.",
  insufficient_balance: "Insufficient voucher balance for this purchase.",
  ineligible_category: "One or more items are not eligible under this voucher.",
  merchant_not_participating: "This merchant is not participating in the program.",
  merchant_closed: "This merchant is currently marked closed.",
  program_inactive: "The relief program is not active, so vouchers cannot be redeemed.",
  cross_community: "Program rules restrict this voucher to merchants in the resident's home community.",
  insufficient_inventory: "Insufficient inventory for the requested quantity.",
  resident_suspended: "This resident's assistance is suspended.",
  empty_basket: "Add at least one item to the basket.",
  invalid_item: "An item in the basket is not available from this merchant.",
};
const issue = (code: ValidationCode, itemId?: string, message?: string): ValidationIssue => ({ code, message: message ?? msg[code], itemId });

function initialsLabel(name: string): string {
  const [first = "", ...rest] = name.split(" ");
  return `${first.slice(0, 1)}. ${rest.length ? rest[rest.length - 1].slice(0, 1) + "." : ""}`.trim();
}

export async function validateTerminal(
  db: D1Database, secret: string, merchantId: string, input: { token: string; items: { inventoryItemId: string; quantity: number }[] }, now: Date,
): Promise<TerminalValidation> {
  const result: TerminalValidation = { ok: false, voucherValid: false, issues: [], voucher: null, basket: { lines: [], totalCents: 0 }, balanceAfterCents: null };
  const parsed = parseVoucherToken(input.token);
  if (!parsed) { result.issues.push(issue("invalid_token")); return result; }

  const v = await first<Row>(
    db,
    `SELECT v.*, p.status AS program_status, p.restrict_home_community, p.end_date, r.community_id AS resident_community, r.status AS resident_status, r.name AS resident_name
     FROM vouchers v JOIN programs p ON p.id = v.program_id JOIN residents r ON r.id = v.resident_id WHERE v.public_code = ?`,
    parsed.code,
  );
  if (!v) { result.issues.push(issue("voucher_not_found")); return result; }
  if (!(await verifyVoucherSignature(secret, v.public_code, v.nonce, parsed.sig))) { result.issues.push(issue("invalid_signature")); return result; }

  const merchant = await first<Row>(db, "SELECT * FROM merchants WHERE id = ?", merchantId);
  const eligible: string[] = JSON.parse(v.eligible_categories_json);
  result.voucher = { code: v.public_code, remainingCents: v.remaining_cents, amountCents: v.amount_cents, expiresAt: v.expires_at, eligibleCategories: eligible, residentLabel: initialsLabel(v.resident_name) };

  const voucherIssues: ValidationIssue[] = [];
  if (!merchant || !merchant.participating) voucherIssues.push(issue("merchant_not_participating"));
  else if (merchant.status === "closed") voucherIssues.push(issue("merchant_closed"));
  if (v.program_status !== "active") voucherIssues.push(issue("program_inactive"));
  if (v.status === "cancelled") voucherIssues.push(issue("voucher_inactive"));
  if (v.expires_at <= now.toISOString()) voucherIssues.push(issue("voucher_expired"));
  if (v.resident_status !== "active") voucherIssues.push(issue("resident_suspended"));
  if (v.remaining_cents <= 0) voucherIssues.push(issue("insufficient_balance", undefined, "This voucher has no remaining balance."));
  if (merchant && v.restrict_home_community && merchant.community_id !== v.resident_community) voucherIssues.push(issue("cross_community"));
  result.issues.push(...voucherIssues);
  result.voucherValid = voucherIssues.length === 0;

  // Basket
  const merged = new Map<string, number>();
  for (const it of input.items) merged.set(it.inventoryItemId, (merged.get(it.inventoryItemId) ?? 0) + it.quantity);
  if (merged.size === 0) { result.issues.push(issue("empty_basket")); return result; }
  const ids = [...merged.keys()];
  const rows = await all<Row>(db, `SELECT * FROM inventory_items WHERE merchant_id = ? AND id IN (${ids.map(() => "?").join(",")})`, merchantId, ...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let total = 0;
  for (const [id, qty] of merged) {
    const row = byId.get(id);
    if (!row) { result.issues.push(issue("invalid_item", id)); continue; }
    if (!eligible.includes(row.category)) result.issues.push(issue("ineligible_category", id, `${row.name} is not eligible under this voucher.`));
    if (row.quantity < qty) result.issues.push(issue("insufficient_inventory", id, `Only ${row.quantity} of ${row.name} in stock (requested ${qty}).`));
    const lineTotal = qty * row.unit_price_cents;
    total += lineTotal;
    result.basket.lines.push({ inventoryItemId: id, name: row.name, category: row.category, quantity: qty, unitPriceCents: row.unit_price_cents, lineTotalCents: lineTotal, available: row.quantity });
  }
  result.basket.totalCents = total;
  if (total > v.remaining_cents) result.issues.push(issue("insufficient_balance"));
  result.balanceAfterCents = v.remaining_cents - total;
  result.ok = result.issues.length === 0;
  return result;
}

export interface Receipt {
  redemptionId: string; receiptNo: string; createdAt: string; status: string; duplicate: boolean;
  merchant: { id: string; name: string }; voucherCode: string; amountCents: number; balanceAfterCents: number; claimId: string;
  items: { name: string; category: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[];
}

export async function loadReceipt(db: D1Database, redemptionId: string, duplicate = false): Promise<Receipt | null> {
  const r = await first<Row>(
    db,
    `SELECT rd.*, m.name AS merchant_name, v.public_code, v.remaining_cents FROM redemptions rd JOIN merchants m ON m.id = rd.merchant_id JOIN vouchers v ON v.id = rd.voucher_id WHERE rd.id = ?`,
    redemptionId,
  );
  if (!r) return null;
  const items = await all<Row>(db, "SELECT * FROM redemption_items WHERE redemption_id = ? ORDER BY id", redemptionId);
  return {
    redemptionId: r.id, receiptNo: r.receipt_no, createdAt: r.created_at, status: r.status, duplicate,
    merchant: { id: r.merchant_id, name: r.merchant_name }, voucherCode: r.public_code, amountCents: r.amount_cents, balanceAfterCents: r.remaining_cents, claimId: r.claim_id,
    items: items.map((i) => ({ name: i.item_name, category: i.category, quantity: i.quantity, unitPriceCents: i.unit_price_cents, lineTotalCents: i.line_total_cents })),
  };
}

/** Atomic voucher redemption. Everything below is ONE D1 batch (a single SQLite transaction):
 *  voucher debit (optimistic version + CHECK remaining >= 0), inventory decrement (CHECK quantity >= 0),
 *  redemption + items, ledger entries, reimbursement claim, movement history, audit entry.
 *  Any failed guard/constraint rolls the whole batch back - there is no partial state. */
export async function redeem(
  db: D1Database, secret: string, user: SessionUser, input: { token: string; items: { inventoryItemId: string; quantity: number }[]; idempotencyKey: string }, now: Date,
): Promise<Receipt> {
  const merchantId = user.merchantId!;
  const nowIso = now.toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await first<Row>(db, "SELECT id, voucher_id, amount_cents FROM redemptions WHERE merchant_id = ? AND idempotency_key = ?", merchantId, input.idempotencyKey);
    if (existing) return replayOrReject(db, secret, existing, input, merchantId, now);

    const v = await validateTerminal(db, secret, merchantId, input, now);
    if (!v.ok) throw new HttpError(422, "redemption_rejected", v.issues[0]?.message ?? "Redemption rejected", { issues: v.issues });

    const parsed = parseVoucherToken(input.token)!;
    const voucher = (await first<Row>(db, "SELECT * FROM vouchers WHERE public_code = ?", parsed.code))!;
    const merchant = (await first<Row>(db, "SELECT * FROM merchants WHERE id = ?", merchantId))!;
    const total = v.basket.totalCents;
    const redemptionId = shortId("red");
    const receiptNo = `RCP-${now.getTime().toString(36).toUpperCase()}${redemptionId.slice(-4).toUpperCase()}`;
    const openClaim = await first<Row>(db, "SELECT id FROM reimbursement_claims WHERE merchant_id = ? AND program_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1", merchantId, voucher.program_id);
    const claimId = openClaim?.id ?? shortId("CLM").replace("CLM_", "CLM-").toUpperCase();
    const newVersion = voucher.version + 1;
    const guardId = shortId("g");
    const guard2 = shortId("g");

    const s: D1PreparedStatement[] = [];
    if (!openClaim) {
      s.push(db.prepare("INSERT INTO reimbursement_claims (id, merchant_id, program_id, amount_cents, item_count, status, created_at) VALUES (?, ?, ?, 0, 0, 'pending', ?)").bind(claimId, merchantId, voucher.program_id, nowIso));
    }
    // 1) Debit the voucher with optimistic concurrency. A concurrent redemption bumps `version`.
    s.push(db.prepare(
      `UPDATE vouchers SET remaining_cents = remaining_cents - ?, version = version + 1,
         status = CASE WHEN remaining_cents - ? = 0 THEN 'exhausted' ELSE 'active' END
       WHERE id = ? AND version = ? AND status = 'active' AND expires_at > ? AND remaining_cents >= ?`,
    ).bind(total, total, voucher.id, voucher.version, nowIso, total));
    s.push(db.prepare("INSERT INTO tx_guards (id, ok) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM vouchers WHERE id = ? AND version = ?) THEN 1 ELSE 0 END").bind(guardId, voucher.id, newVersion));
    // 2) Redemption header (UNIQUE(merchant_id, idempotency_key) blocks duplicates), then lines + stock.
    s.push(db.prepare(
      `INSERT INTO redemptions (id, receipt_no, program_id, voucher_id, resident_id, merchant_id, community_id, claim_id, amount_cents, status, idempotency_key, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    ).bind(redemptionId, receiptNo, voucher.program_id, voucher.id, voucher.resident_id, merchantId, merchant.community_id, claimId, total, input.idempotencyKey, user.id, nowIso));
    v.basket.lines.forEach((l, n) => {
      s.push(db.prepare("INSERT INTO redemption_items (id, redemption_id, inventory_item_id, item_name, category, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(`${redemptionId}_i${n + 1}`, redemptionId, l.inventoryItemId, l.name, l.category, l.quantity, l.unitPriceCents, l.lineTotalCents));
      // CHECK (quantity >= 0) aborts the whole batch if stock would go negative.
      s.push(db.prepare("UPDATE inventory_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND merchant_id = ?").bind(l.quantity, nowIso, l.inventoryItemId, merchantId));
      s.push(db.prepare(
        `INSERT INTO inventory_movements (id, inventory_item_id, merchant_id, community_id, delta, quantity_after, reason, note, ref_id, actor_user_id, created_at)
         SELECT ?, id, merchant_id, community_id, ?, quantity, 'redemption', ?, ?, ?, ? FROM inventory_items WHERE id = ?`,
      ).bind(`${redemptionId}_m${n + 1}`, -l.quantity, `Voucher redemption ${receiptNo}`, redemptionId, user.id, nowIso, l.inventoryItemId));
    });
    // 3) Claim bookkeeping - fails (rolls back) if a coordinator decided the claim in the meantime.
    s.push(db.prepare("UPDATE reimbursement_claims SET amount_cents = amount_cents + ?, item_count = item_count + 1 WHERE id = ? AND status = 'pending'").bind(total, claimId));
    s.push(db.prepare("INSERT INTO tx_guards (id, ok) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM reimbursement_claims WHERE id = ? AND status = 'pending') THEN 1 ELSE 0 END").bind(guard2, claimId));
    s.push(db.prepare("INSERT INTO reimbursement_items (id, claim_id, redemption_id, amount_cents, voided) VALUES (?, ?, ?, ?, 0)").bind(`${claimId}_${redemptionId}`, claimId, redemptionId, total));
    // 4) Append-only ledger.
    s.push(db.prepare(
      `INSERT INTO ledger_entries (id, program_id, account_type, resident_id, merchant_id, voucher_id, redemption_id, entry_type, amount_cents, memo, created_by, created_at)
       VALUES (?, ?, 'resident', ?, NULL, ?, ?, 'voucher_redeemed', ?, ?, ?, ?)`,
    ).bind(`${redemptionId}_lr`, voucher.program_id, voucher.resident_id, voucher.id, redemptionId, -total, `Redeemed at ${merchant.name} (${receiptNo})`, user.id, nowIso));
    s.push(db.prepare(
      `INSERT INTO ledger_entries (id, program_id, account_type, resident_id, merchant_id, voucher_id, redemption_id, entry_type, amount_cents, memo, created_by, created_at)
       VALUES (?, ?, 'merchant', NULL, ?, ?, ?, 'reimbursement_claim_created', ?, ?, ?, ?)`,
    ).bind(`${redemptionId}_lm`, voucher.program_id, merchantId, voucher.id, redemptionId, total, `Claim ${claimId} for ${receiptNo}`, user.id, nowIso));
    s.push(auditStmt(db, user, "voucher.redeemed", "redemption", redemptionId, voucher.program_id, { receipt: receiptNo, voucher: voucher.public_code, amountCents: total, claimId }, nowIso));
    s.push(db.prepare("DELETE FROM tx_guards WHERE id IN (?, ?)").bind(guardId, guard2));

    try {
      await db.batch(s);
    } catch (err) {
      const m = String((err as Error)?.message ?? err);
      console.warn("redeem batch rolled back:", m);
      if (m.includes("idempotency_key") || (m.includes("UNIQUE") && m.includes("redemptions"))) {
        const dup = await first<Row>(db, "SELECT id, voucher_id, amount_cents FROM redemptions WHERE merchant_id = ? AND idempotency_key = ?", merchantId, input.idempotencyKey);
        if (dup) return replayOrReject(db, secret, dup, input, merchantId, now);
      }
      // Guard/CHECK failure: the batch rolled back completely. Re-validate against fresh state; if the
      // request is no longer valid (e.g. another redemption drained the balance) the loop surfaces that;
      // if it is still valid (e.g. claim race) we retry.
      if (attempt === 2) throw conflict("The voucher or inventory changed while processing. Please retry.", "concurrent_update");
      continue;
    }
    return (await loadReceipt(db, redemptionId))!;
  }
  throw conflict("Could not complete the redemption. Please retry.", "concurrent_update");
}

async function replayOrReject(db: D1Database, secret: string, existing: Row, input: { token: string }, merchantId: string, _now: Date): Promise<Receipt> {
  const parsed = parseVoucherToken(input.token);
  const v = parsed ? await first<Row>(db, "SELECT id FROM vouchers WHERE public_code = ?", parsed.code) : null;
  void secret; void merchantId;
  if (!v || v.id !== existing.voucher_id) throw conflict("This idempotency key was already used for a different voucher.", "idempotency_mismatch");
  return (await loadReceipt(db, existing.id, true))!;
}

/** Coordinator correction: post reversal entries, restore stock and balance, void the claim item. Never edits old ledger rows. */
export async function reverseRedemption(db: D1Database, user: SessionUser, redemptionId: string, reason: string, now: Date): Promise<Receipt> {
  const nowIso = now.toISOString();
  const r = await first<Row>(db, "SELECT * FROM redemptions WHERE id = ?", redemptionId);
  if (!r) throw new HttpError(404, "not_found", "Redemption not found");
  if (r.status !== "completed") throw conflict("This redemption was already reversed.", "already_reversed");
  const claim = await first<Row>(db, "SELECT * FROM reimbursement_claims WHERE id = ?", r.claim_id);
  if (!claim || claim.status !== "pending") throw conflict("The merchant claim for this redemption has already been decided; it cannot be reversed here.", "claim_decided");
  const items = await all<Row>(db, "SELECT * FROM redemption_items WHERE redemption_id = ?", redemptionId);
  const origLedger = await all<Row>(db, "SELECT id, entry_type FROM ledger_entries WHERE redemption_id = ? AND entry_type IN ('voucher_redeemed','reimbursement_claim_created')", redemptionId);
  const lr = origLedger.find((x) => x.entry_type === "voucher_redeemed")?.id ?? null;
  const lm = origLedger.find((x) => x.entry_type === "reimbursement_claim_created")?.id ?? null;
  const g = shortId("g"), g2 = shortId("g");

  const s: D1PreparedStatement[] = [
    db.prepare("UPDATE redemptions SET status = 'reversed', reversed_at = ?, reversal_reason = ? WHERE id = ? AND status = 'completed'").bind(nowIso, reason, redemptionId),
    db.prepare("INSERT INTO tx_guards (id, ok) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM redemptions WHERE id = ? AND status = 'reversed' AND reversed_at = ?) THEN 1 ELSE 0 END").bind(g, redemptionId, nowIso),
    // CHECK (remaining_cents <= amount_cents) prevents over-crediting.
    db.prepare("UPDATE vouchers SET remaining_cents = remaining_cents + ?, version = version + 1, status = 'active' WHERE id = ?").bind(r.amount_cents, r.voucher_id),
  ];
  items.forEach((i, n) => {
    s.push(db.prepare("UPDATE inventory_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?").bind(i.quantity, nowIso, i.inventory_item_id));
    s.push(db.prepare(
      `INSERT INTO inventory_movements (id, inventory_item_id, merchant_id, community_id, delta, quantity_after, reason, note, ref_id, actor_user_id, created_at)
       SELECT ?, id, merchant_id, community_id, ?, quantity, 'reversal', ?, ?, ?, ? FROM inventory_items WHERE id = ?`,
    ).bind(`${redemptionId}_rv${n + 1}`, i.quantity, `Reversal of ${r.receipt_no}: ${reason}`, redemptionId, user.id, nowIso, i.inventory_item_id));
  });
  s.push(db.prepare("UPDATE reimbursement_claims SET amount_cents = amount_cents - ?, item_count = item_count - 1 WHERE id = ? AND status = 'pending'").bind(r.amount_cents, r.claim_id));
  s.push(db.prepare("INSERT INTO tx_guards (id, ok) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM reimbursement_claims WHERE id = ? AND status = 'pending') THEN 1 ELSE 0 END").bind(g2, r.claim_id));
  s.push(db.prepare("UPDATE reimbursement_items SET voided = 1 WHERE redemption_id = ?").bind(redemptionId));
  s.push(db.prepare(
    `INSERT INTO ledger_entries (id, program_id, account_type, resident_id, merchant_id, voucher_id, redemption_id, entry_type, amount_cents, memo, reverses_entry_id, created_by, created_at)
     VALUES (?, ?, 'resident', ?, NULL, ?, ?, 'voucher_reversal', ?, ?, ?, ?, ?)`,
  ).bind(`${redemptionId}_rr`, r.program_id, r.resident_id, r.voucher_id, redemptionId, r.amount_cents, `Reversal of ${r.receipt_no}: ${reason}`, lr, user.id, nowIso));
  s.push(db.prepare(
    `INSERT INTO ledger_entries (id, program_id, account_type, resident_id, merchant_id, voucher_id, redemption_id, entry_type, amount_cents, memo, reverses_entry_id, created_by, created_at)
     VALUES (?, ?, 'merchant', NULL, ?, ?, ?, 'reimbursement_claim_reversed', ?, ?, ?, ?, ?)`,
  ).bind(`${redemptionId}_rm`, r.program_id, r.merchant_id, r.voucher_id, redemptionId, -r.amount_cents, `Claim ${r.claim_id} adjusted: reversal of ${r.receipt_no}`, lm, user.id, nowIso));
  s.push(auditStmt(db, user, "voucher.reversed", "redemption", redemptionId, r.program_id, { receipt: r.receipt_no, amountCents: r.amount_cents, reason }, nowIso));
  s.push(db.prepare("DELETE FROM tx_guards WHERE id IN (?, ?)").bind(g, g2));
  try {
    await db.batch(s);
  } catch {
    throw conflict("The reversal could not be applied because related records changed. Refresh and try again.", "concurrent_update");
  }
  return (await loadReceipt(db, redemptionId))!;
}

export { stockStatus, signVoucher };
