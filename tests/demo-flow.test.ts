import { describe, expect, it } from "vitest";
import { setup } from "./helpers/app";

/** The 12-step Pine Valley demonstration, executed against the real API. Nothing is mocked or hard-coded. */
describe("Pine Valley demonstration flow", () => {
  it("runs end to end without altering seed data through the simulator", async () => {
    const t = setup();
    const co = await t.login("coordinator");
    const programs = (await t.call("GET", "/api/programs", { cookie: co })).json.items;
    const pv = programs.find((p: any) => p.name === "Pine Valley Wildfire Response");
    expect(pv.status).toBe("active");

    // 2-4: three communities and the baseline analysis
    const live = (await t.call("GET", `/api/intelligence/live?programId=${pv.id}`, { cookie: co })).json.analysis;
    expect(live.communities.map((c: any) => c.name).sort()).toEqual(["Cedar Grove", "East Valley", "North Ridge"]);
    const base = Object.fromEntries(live.communities.map((c: any) => [c.name, c]));
    expect(base["North Ridge"].marketViability).toBeGreaterThan(base["Cedar Grove"].marketViability);
    expect(base["Cedar Grove"].marketViability).toBeGreaterThan(base["East Valley"].marketViability);

    // 5-8: Cedar Grove merchant closure + water shipment delay, compared with baseline
    const cedar = (await t.call("GET", `/api/communities?programId=${pv.id}`, { cookie: co })).json.items.find((c: any) => c.name === "Cedar Grove");
    const merchants = (await t.call("GET", `/api/communities/${cedar.id}`, { cookie: co })).json.merchants;
    const major = merchants.find((m: any) => m.name === "Cedar Grove Grocers");
    const tableDump = () => JSON.stringify(["merchants", "inventory_items", "planned_shipments", "daily_demand_observations", "allocation_runs", "vouchers", "ledger_entries"].map((n) => t.db.raw.prepare(`SELECT * FROM ${n} ORDER BY rowid`).all()));
    const before = tableDump();
    const preview = (await t.call("POST", "/api/intelligence/scenarios/preview", { cookie: co, body: { programId: pv.id, adjustments: [
      { kind: "merchant_status", merchantId: major.id, status: "closed" },
      { kind: "shipment_delay", communityId: cedar.id, category: "drinking_water", delayHours: 24 },
    ] } })).json;
    const adj = Object.fromEntries(preview.adjusted.communities.map((c: any) => [c.name, c]));
    expect(adj["Cedar Grove"].marketViability).toBeLessThan(base["Cedar Grove"].marketViability);
    expect(adj["East Valley"].marketViability).toBeCloseTo(base["East Valley"].marketViability, 10);
    expect(tableDump()).toBe(before); // the simulator never writes

    // 9-11: resident receives assistance, merchant redeems, ledger + claim update
    const issue = await t.call("POST", "/api/residents/RES-1006/vouchers", { cookie: co, body: { amountCents: 10000, eligibleCategories: ["drinking_water", "food_packages"] } });
    expect(issue.status).toBe(201);
    const res = await t.login("resident", "usr_res_1006");
    const voucher = (await t.call("GET", "/api/resident/vouchers", { cookie: res })).json.items.find((v: any) => v.id === issue.json.voucher?.id || v.amountCents === 10000);
    expect(voucher.token).toBeTruthy();
    const mer = await t.login("merchant", "usr_mer_1004");
    const water = (await t.call("GET", "/api/merchant/products", { cookie: mer })).json.items.find((p: any) => p.category === "drinking_water");
    const claimsBefore = (await t.call("GET", "/api/reconciliation", { cookie: co })).json.summary.totalClaims.cents;
    const sale = await t.call("POST", "/api/merchant/terminal/redeem", { cookie: mer, body: { token: voucher.token, items: [{ inventoryItemId: water.id, quantity: 3 }], idempotencyKey: crypto.randomUUID() } });
    expect(sale.status).toBe(201);
    expect(sale.json.receipt.amountCents).toBe(3 * water.unitPriceCents);

    // 12: coordinator sees the resulting financial records
    const claims = (await t.call("GET", "/api/reconciliation", { cookie: co })).json;
    expect(claims.summary.totalClaims.cents).toBe(claimsBefore + 3 * water.unitPriceCents);
    const tx = (await t.call("GET", `/api/transactions?programId=${pv.id}`, { cookie: co })).json;
    expect(JSON.stringify(tx)).toContain(sale.json.receipt.receiptNo);
  });
});

describe("database integrity invariants", () => {
  it("money is stored as integer cents, nothing is negative, and the schema refuses negative stock or balances", async () => {
    const t = setup();
    const co = await t.login("coordinator");
    const mer = await t.login("merchant", "usr_mer_1004");
    const res = await t.login("resident", "usr_res_1005");
    const v = (await t.call("GET", "/api/resident/vouchers", { cookie: res })).json.items.find((x: any) => x.status === "active" && x.token);
    const water = (await t.call("GET", "/api/merchant/products", { cookie: mer })).json.items.find((p: any) => p.category === "drinking_water");
    const sale = await t.call("POST", "/api/merchant/terminal/redeem", { cookie: mer, body: { token: v.token, items: [{ inventoryItemId: water.id, quantity: 2 }], idempotencyKey: crypto.randomUUID() } });
    expect(sale.status).toBe(201);
    await t.call("POST", `/api/transactions/redemptions/${sale.json.receipt.redemptionId}/reverse`, { cookie: co, body: { reason: "test" } });

    const money: [string, string][] = [["programs", "budget_cents"], ["vouchers", "amount_cents"], ["vouchers", "remaining_cents"], ["inventory_items", "unit_price_cents"], ["ledger_entries", "amount_cents"], ["reimbursement_claims", "amount_cents"], ["allocation_runs", "total_recommended_cents"]];
    for (const [table, col] of money) {
      const bad = t.db.raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE typeof(${col}) <> 'integer'`).get() as any;
      expect(bad.n, `${table}.${col} must be integer cents`).toBe(0);
    }
    expect((t.db.raw.prepare("SELECT COUNT(*) n FROM inventory_items WHERE quantity < 0").get() as any).n).toBe(0);
    expect((t.db.raw.prepare("SELECT COUNT(*) n FROM vouchers WHERE remaining_cents < 0 OR remaining_cents > amount_cents").get() as any).n).toBe(0);
    expect(() => t.db.raw.prepare("UPDATE inventory_items SET quantity = -1").run()).toThrow();
    expect(() => t.db.raw.prepare("UPDATE vouchers SET remaining_cents = -1").run()).toThrow();
  });
});
