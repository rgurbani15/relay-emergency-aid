import { beforeEach, describe, expect, it } from "vitest";
import { setup, type TestCtx } from "./helpers/app";

let t: TestCtx;
let merchant: string, resident: string, coordinator: string;
let token: string, voucherId: string, remaining: number;
let waterId: string, waterPrice: number, foodId: string;

const basket = (qty: number, id = waterId) => [{ inventoryItemId: id, quantity: qty }];
const key = () => crypto.randomUUID();

beforeEach(async () => {
  t = setup();
  coordinator = await t.login("coordinator");
  merchant = await t.login("merchant", "usr_mer_1004"); // Cedar Grove Grocers
  resident = await t.login("resident", "usr_res_1005"); // Hannah Okafor
  const v = (await t.call("GET", "/api/resident/vouchers", { cookie: resident })).json.items.find((x: any) => x.eligibleCategories.length === 7 && x.status === "active");
  token = v.token; voucherId = v.id; remaining = v.remainingCents;
  const products = (await t.call("GET", "/api/merchant/products", { cookie: merchant })).json.items;
  const water = products.find((p: any) => p.category === "drinking_water");
  const food = products.find((p: any) => p.category === "food_packages");
  waterId = water.id; waterPrice = water.unitPriceCents; foodId = food.id;
});

const redeem = (items: any[], opts: { token?: string; key?: string; cookie?: string } = {}) =>
  t.call("POST", "/api/merchant/terminal/redeem", { cookie: opts.cookie ?? merchant, body: { token: opts.token ?? token, items, idempotencyKey: opts.key ?? key() } });
const stock = (id: string) => (t.db.raw.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(id) as any).quantity as number;
const voucherRow = () => t.db.raw.prepare("SELECT * FROM vouchers WHERE id = ?").get(voucherId) as any;

describe("voucher redemption", () => {
  it("redeems successfully: debits voucher, decrements stock, writes ledger, claim, audit and receipt", async () => {
    const before = stock(waterId);
    const r = await redeem(basket(5));
    expect(r.status).toBe(201);
    const rc = r.json.receipt;
    expect(rc.amountCents).toBe(5 * waterPrice);
    expect(rc.balanceAfterCents).toBe(remaining - 5 * waterPrice);
    expect(stock(waterId)).toBe(before - 5);
    expect(voucherRow().remaining_cents).toBe(remaining - 5 * waterPrice);
    const led = t.db.raw.prepare("SELECT entry_type, amount_cents FROM ledger_entries WHERE redemption_id = ? ORDER BY entry_type").all(rc.redemptionId) as any[];
    expect(led).toEqual([{ entry_type: "reimbursement_claim_created", amount_cents: 5 * waterPrice }, { entry_type: "voucher_redeemed", amount_cents: -5 * waterPrice }]);
    const claim = t.db.raw.prepare("SELECT * FROM reimbursement_claims WHERE id = ?").get(rc.claimId) as any;
    expect(claim.status).toBe("pending");
    expect(t.db.raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'voucher.redeemed' AND entity_id = ?").get(rc.redemptionId)).toEqual({ n: 1 });
    expect(t.db.raw.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE ref_id = ?").get(rc.redemptionId)).toEqual({ n: 1 });
  });

  it("rejects an invalid signature and malformed tokens", async () => {
    const forged = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const r = await redeem(basket(1), { token: forged });
    expect(r.status).toBe(422);
    expect(r.json.error.details.issues[0].code).toBe("invalid_signature");
    const garbage = await redeem(basket(1), { token: "hello-world" });
    expect(garbage.json.error.details.issues[0].code).toBe("invalid_token");
    expect(voucherRow().remaining_cents).toBe(remaining);
  });

  it("rejects an expired voucher", async () => {
    t.clock.now = new Date("2027-03-01T00:00:00Z");
    const m = await t.login("merchant", "usr_mer_1004");
    const r = await redeem(basket(1), { cookie: m });
    expect(r.status).toBe(422);
    expect(r.json.error.details.issues.map((i: any) => i.code)).toContain("voucher_expired");
  });

  it("rejects insufficient balance without changing anything", async () => {
    const qty = Math.ceil((remaining + 1) / waterPrice);
    const before = stock(waterId);
    const r = await redeem(basket(qty));
    // may also fail for inventory; the balance error must be reported either way
    expect(r.status).toBe(422);
    expect(r.json.error.details.issues.map((i: any) => i.code)).toContain("insufficient_balance");
    expect(stock(waterId)).toBe(before);
    expect(voucherRow().remaining_cents).toBe(remaining);
  });

  it("rejects insufficient inventory and never lets stock go negative", async () => {
    const have = stock(waterId);
    const r = await redeem(basket(have + 1));
    expect(r.status).toBe(422);
    expect(r.json.error.details.issues.map((i: any) => i.code)).toContain("insufficient_inventory");
    expect(stock(waterId)).toBe(have);
    // the database itself also refuses negative stock
    expect(() => t.db.raw.prepare("UPDATE inventory_items SET quantity = -1 WHERE id = ?").run(waterId)).toThrow(/CHECK/i);
  });

  it("rejects ineligible categories", async () => {
    const restricted = (await t.call("GET", "/api/resident/vouchers", { cookie: resident })).json.items.find((x: any) => x.eligibleCategories.length === 3);
    if (!restricted) return;
    const products = (await t.call("GET", "/api/merchant/products", { cookie: merchant })).json.items;
    const other = products.find((p: any) => p.category === "other_essentials" && p.quantity > 0);
    const r = await redeem(basket(1, other.id), { token: restricted.token });
    expect(r.status).toBe(422);
    expect(r.json.error.details.issues.map((i: any) => i.code)).toContain("ineligible_category");
  });

  it("rejects cross-community use when program rules restrict it", async () => {
    const nrMerchant = await t.login("merchant", "usr_mer_1001");
    const products = (await t.call("GET", "/api/merchant/products", { cookie: nrMerchant })).json.items;
    const r = await t.call("POST", "/api/merchant/terminal/redeem", { cookie: nrMerchant, body: { token, items: [{ inventoryItemId: products[0].id, quantity: 1 }], idempotencyKey: key() } });
    expect(r.status).toBe(422);
    expect(r.json.error.details.issues.map((i: any) => i.code)).toContain("cross_community");
  });

  it("a duplicate request (same idempotency key) cannot debit the voucher twice", async () => {
    const k = key();
    const a = await redeem(basket(3), { key: k });
    const b = await redeem(basket(3), { key: k });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.receipt.duplicate).toBe(true);
    expect(b.json.receipt.redemptionId).toBe(a.json.receipt.redemptionId);
    expect(voucherRow().remaining_cents).toBe(remaining - 3 * waterPrice);
    expect(t.db.raw.prepare("SELECT COUNT(*) n FROM redemptions WHERE idempotency_key = ?").get(k)).toEqual({ n: 1 });
  });

  it("reusing an idempotency key for a different voucher is rejected", async () => {
    const k = key();
    await redeem(basket(1), { key: k });
    const other = (await t.call("GET", "/api/resident/vouchers", { cookie: resident })).json.items.find((x: any) => x.id !== voucherId && x.status === "active");
    if (!other) return;
    const r = await redeem(basket(1), { key: k, token: other.token });
    expect(r.status).toBe(409);
  });

  it("two simultaneous attempts to redeem the same balance: exactly one succeeds", async () => {
    // each basket is ~60% of the remaining balance, so both cannot fit
    const qty = Math.floor((remaining * 0.6) / waterPrice);
    expect(qty * waterPrice * 2).toBeGreaterThan(remaining);
    const before = stock(waterId);
    const [a, b] = await Promise.all([redeem(basket(qty)), redeem(basket(qty))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 422]);
    expect(voucherRow().remaining_cents).toBe(remaining - qty * waterPrice);
    expect(voucherRow().remaining_cents).toBeGreaterThanOrEqual(0);
    expect(stock(waterId)).toBe(before - qty);
    expect(t.db.raw.prepare("SELECT COUNT(*) n FROM redemptions WHERE voucher_id = ? AND created_at = ?").get(voucherId, "2026-11-12T16:00:00.000Z")).toEqual({ n: 1 });
  });

  it("simultaneous duplicate submissions with the same idempotency key produce one redemption", async () => {
    const k = key();
    const [a, b] = await Promise.all([redeem(basket(2), { key: k }), redeem(basket(2), { key: k })]);
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
    expect(a.json.receipt.redemptionId).toBe(b.json.receipt.redemptionId);
    expect(voucherRow().remaining_cents).toBe(remaining - 2 * waterPrice);
  });

  it("a failed batch leaves no partial state (balance, stock, ledger, claims all untouched)", async () => {
    const snapshot = () => JSON.stringify([
      t.db.raw.prepare("SELECT COUNT(*) n FROM ledger_entries").get(), t.db.raw.prepare("SELECT COUNT(*) n FROM redemptions").get(),
      t.db.raw.prepare("SELECT SUM(quantity) q FROM inventory_items").get(), t.db.raw.prepare("SELECT SUM(amount_cents) a FROM reimbursement_claims").get(),
    ]);
    const before = snapshot();
    // two lines: first is fine, second exceeds stock -> validation catches it; also exercise the raw DB atomicity:
    await expect(t.db.batch([
      t.db.prepare("UPDATE vouchers SET remaining_cents = remaining_cents - 1 WHERE id = ?").bind(voucherId),
      t.db.prepare("UPDATE inventory_items SET quantity = quantity - 999999 WHERE id = ?").bind(waterId),
    ] as never)).rejects.toThrow();
    expect(snapshot()).toBe(before);
    expect(voucherRow().remaining_cents).toBe(remaining);
  });

  it("merchant authorization: residents cannot redeem, merchants cannot sell another merchant's stock", async () => {
    expect((await redeem(basket(1), { cookie: resident })).status).toBe(403);
    expect((await redeem(basket(1), { cookie: coordinator })).status).toBe(403);
    expect((await redeem(basket(1), { cookie: "" })).status).toBe(401);
    const other = await t.login("merchant", "usr_mer_1005"); // Grove Family Pharmacy
    const r = await redeem(basket(1), { cookie: other }); // water item belongs to MER-1004
    expect(r.status).toBe(422);
    expect(r.json.error.details.issues.map((i: any) => i.code)).toContain("invalid_item");
  });

  it("coordinator reversal restores balance and stock using reversal entries (old ledger rows untouched)", async () => {
    const stockBefore = stock(waterId);
    const ledgerBefore = t.db.raw.prepare("SELECT COUNT(*) n FROM ledger_entries").get() as any;
    const r = await redeem(basket(4));
    const id = r.json.receipt.redemptionId;
    const rev = await t.call("POST", `/api/transactions/redemptions/${id}/reverse`, { cookie: coordinator, body: { reason: "Customer returned goods" } });
    expect(rev.status).toBe(200);
    expect(voucherRow().remaining_cents).toBe(remaining);
    expect(stock(waterId)).toBe(stockBefore);
    expect((t.db.raw.prepare("SELECT COUNT(*) n FROM ledger_entries").get() as any).n).toBe(ledgerBefore.n + 4);
    expect((await t.call("POST", `/api/transactions/redemptions/${id}/reverse`, { cookie: coordinator, body: { reason: "again" } })).status).toBe(409);
    expect(() => t.db.raw.prepare("UPDATE ledger_entries SET amount_cents = 1").run()).toThrow(/immutable/);
    expect(() => t.db.raw.prepare("DELETE FROM ledger_entries").run()).toThrow(/immutable/);
    expect(() => t.db.raw.prepare("DELETE FROM audit_logs").run()).toThrow(/append-only/);
  });

  it("ledger always reconciles with voucher balances and merchant claims", async () => {
    await redeem(basket(2));
    await redeem(basket(1, foodId));
    const a = t.db.raw.prepare("SELECT (SELECT SUM(amount_cents) FROM ledger_entries WHERE account_type='resident') l, (SELECT SUM(remaining_cents) FROM vouchers) v").get() as any;
    expect(a.l).toBe(a.v);
    const b = t.db.raw.prepare("SELECT (SELECT SUM(amount_cents) FROM ledger_entries WHERE account_type='merchant') l, (SELECT SUM(amount_cents) FROM reimbursement_claims WHERE status IN ('pending','approved')) c").get() as any;
    expect(b.l).toBe(b.c);
  });
});

describe("assistance issuance and claims", () => {
  it("issues assistance with a ledger entry and enforces the program budget", async () => {
    const ok = await t.call("POST", "/api/residents/RES-1006/vouchers", { cookie: coordinator, body: { amountCents: 25000, eligibleCategories: ["drinking_water", "food_packages"] } });
    expect(ok.status).toBe(201);
    const bal = (await t.call("GET", "/api/residents/RES-1006", { cookie: coordinator })).json.resident.balanceCents;
    expect(bal).toBeGreaterThanOrEqual(25000);
    const tooMuch = await t.call("POST", "/api/residents/RES-1006/vouchers", { cookie: coordinator, body: { amountCents: 999_999_999, eligibleCategories: ["drinking_water"] } });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.json.error.code).toBe("budget_exceeded");
    expect((await t.call("POST", "/api/residents/RES-1006/vouchers", { cookie: coordinator, body: { amountCents: 12.5, eligibleCategories: ["drinking_water"] } })).status).toBe(400);
    expect((await t.call("POST", "/api/residents/RES-1006/vouchers", { cookie: coordinator, body: { amountCents: -500, eligibleCategories: ["drinking_water"] } })).status).toBe(400);
    expect((await t.call("POST", "/api/residents/RES-1012/vouchers", { cookie: coordinator, body: { amountCents: 500, eligibleCategories: ["drinking_water"] } })).status).toBe(409);
  });

  it("approves and rejects reconciliation claims with audit records; approval never claims payment", async () => {
    const list = (await t.call("GET", "/api/reconciliation?status=pending&programId=prog_pine_valley", { cookie: coordinator })).json;
    const [c1, c2] = list.items;
    const ok = await t.call("POST", `/api/reconciliation/claims/${c1.id}/approve`, { cookie: coordinator, body: {} });
    expect(ok.json.claim.status).toBe("approved");
    const noReason = await t.call("POST", `/api/reconciliation/claims/${c2.id}/reject`, { cookie: coordinator, body: {} });
    expect(noReason.status).toBe(400);
    const rej = await t.call("POST", `/api/reconciliation/claims/${c2.id}/reject`, { cookie: coordinator, body: { reason: "Duplicate receipt" } });
    expect(rej.json.claim.status).toBe("rejected");
    expect((await t.call("POST", `/api/reconciliation/claims/${c1.id}/approve`, { cookie: coordinator, body: {} })).status).toBe(409);
    const a = t.db.raw.prepare("SELECT (SELECT SUM(amount_cents) FROM ledger_entries WHERE account_type='merchant') l, (SELECT SUM(amount_cents) FROM reimbursement_claims WHERE status IN ('pending','approved')) c").get() as any;
    expect(a.l).toBe(a.c);
    const audit = (await t.call("GET", "/api/audit?action=claim", { cookie: coordinator })).json;
    expect(audit.items.some((x: any) => x.action === "claim.rejected" && x.entityId === c2.id)).toBe(true);
    expect(JSON.stringify(ok.json)).not.toMatch(/paid/i);
  });
});
