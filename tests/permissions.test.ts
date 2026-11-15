import { beforeEach, describe, expect, it } from "vitest";
import { setup, type TestCtx } from "./helpers/app";

let t: TestCtx;
beforeEach(() => { t = setup(); });

describe("authentication and role permissions", () => {
  it("rejects requests without a session and with invalid sessions", async () => {
    expect((await t.call("GET", "/api/programs")).status).toBe(401);
    expect((await t.call("GET", "/api/programs", { cookie: "relay_session=forged-token" })).status).toBe(401);
    expect((await t.call("GET", "/api/resident/summary", { cookie: "relay_session=" })).status).toBe(401);
  });

  it("session cookie is HttpOnly + SameSite and the role comes from the database", async () => {
    const res = await t.call("POST", "/api/auth/demo", { body: { role: "resident" } });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.json.user.role).toBe("resident");
    // a client-supplied role field in the body/headers is ignored for authorization
    const sneaky = await t.call("GET", "/api/programs", { cookie: cookie.split(";")[0], headers: { "x-role": "coordinator" } });
    expect(sneaky.status).toBe(403);
    // demo login cannot mint a role the chosen account does not have
    expect((await t.call("POST", "/api/auth/demo", { body: { role: "coordinator", userId: "usr_res_1005" } })).status).toBe(404);
  });

  it("demo sign-in is explicitly disabled when DEMO_MODE is not true", async () => {
    const off = setup({ env: { DEMO_MODE: "false" } });
    expect((await off.call("POST", "/api/auth/demo", { body: { role: "coordinator" } })).status).toBe(403);
    expect((await off.call("GET", "/api/auth/demo-accounts")).status).toBe(403);
    const unset = setup({ env: { DEMO_MODE: undefined } });
    expect((await unset.call("POST", "/api/auth/demo", { body: { role: "coordinator" } })).status).toBe(403);
    expect((await off.call("GET", "/api/health")).json.demoMode).toBe(false);
  });

  it("residents cannot access coordinator or merchant endpoints", async () => {
    const r = await t.login("resident");
    for (const p of ["/api/programs", "/api/residents", "/api/merchants", "/api/audit", "/api/intelligence/live?programId=prog_pine_valley", "/api/reconciliation", "/api/inventory", "/api/merchant/dashboard", "/api/allocations"]) {
      expect((await t.call("GET", p, { cookie: r })).status, p).toBe(403);
    }
    expect((await t.call("POST", "/api/residents/RES-1001/vouchers", { cookie: r, body: { amountCents: 100, eligibleCategories: ["blankets"] } })).status).toBe(403);
  });

  it("merchants cannot access coordinator or resident endpoints", async () => {
    const m = await t.login("merchant");
    for (const p of ["/api/programs", "/api/residents", "/api/audit", "/api/reconciliation", "/api/resident/summary", "/api/allocations"]) {
      expect((await t.call("GET", p, { cookie: m })).status, p).toBe(403);
    }
  });

  it("merchants only see and edit their own inventory", async () => {
    const m = await t.login("merchant", "usr_mer_1004");
    const mine = (await t.call("GET", "/api/inventory?pageSize=100", { cookie: m })).json;
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((i: any) => i.merchantId === "MER-1004")).toBe(true);
    const foreign = (t.db.raw.prepare("SELECT id FROM inventory_items WHERE merchant_id = 'MER-1001' LIMIT 1").get() as any).id;
    expect((await t.call("POST", `/api/inventory/${foreign}/adjust`, { cookie: m, body: { mode: "delta", value: 5, reason: "restock" } })).status).toBe(404);
    expect((await t.call("GET", `/api/inventory/${foreign}/movements`, { cookie: m })).status).toBe(404);
    const own = mine.items[0];
    const ok = await t.call("POST", `/api/inventory/${own.id}/adjust`, { cookie: m, body: { mode: "delta", value: 5, reason: "restock", note: "delivery" } });
    expect(ok.status).toBe(200);
    expect(ok.json.item.quantity).toBe(own.quantity + 5);
    expect((await t.call("POST", `/api/inventory/${own.id}/adjust`, { cookie: m, body: { mode: "delta", value: -9_999_999, reason: "adjustment" } })).status).toBe(400);
    expect((await t.call("POST", `/api/inventory/${own.id}/adjust`, { cookie: m, body: { mode: "set", value: -1, reason: "correction" } })).status).toBe(409);
  });

  it("merchants cannot read another merchant's claims, sales or receipts", async () => {
    const m = await t.login("merchant", "usr_mer_1004");
    const otherClaim = (t.db.raw.prepare("SELECT id FROM reimbursement_claims WHERE merchant_id <> 'MER-1004' LIMIT 1").get() as any).id;
    expect((await t.call("GET", `/api/merchant/reimbursements/${otherClaim}`, { cookie: m })).status).toBe(404);
    const otherSale = (t.db.raw.prepare("SELECT id FROM redemptions WHERE merchant_id <> 'MER-1004' LIMIT 1").get() as any).id;
    expect((await t.call("GET", `/api/merchant/sales/${otherSale}`, { cookie: m })).status).toBe(404);
    const sales = (await t.call("GET", "/api/merchant/sales?pageSize=100", { cookie: m })).json;
    expect(sales.items.every((s: any) => !/RES-/.test(JSON.stringify(s)))).toBe(true);
  });

  it("residents only see their own records", async () => {
    const r = await t.login("resident", "usr_res_1005");
    const act = (await t.call("GET", "/api/resident/activity?pageSize=100", { cookie: r })).json;
    const ids = new Set((t.db.raw.prepare("SELECT id FROM ledger_entries WHERE resident_id = 'RES-1005'").all() as any[]).map((x) => x.id));
    expect(act.items.length).toBe(ids.size);
    expect(act.items.every((x: any) => ids.has(x.id))).toBe(true);
    const v = (await t.call("GET", "/api/resident/vouchers", { cookie: r })).json.items;
    expect(v.every((x: any) => !("residentId" in x))).toBe(true);
    // token contains only code + signature
    expect(v[0].token).toMatch(/^VCH-[A-Z0-9]+-[0-9A-Z]{8}$/);
  });

  it("coordinators can manage programs; invalid transitions and budgets are refused; audit entries are written", async () => {
    const c = await t.login("coordinator");
    const created = await t.call("POST", "/api/programs", { cookie: c, body: { name: "Test Flood Program", description: "", emergencyType: "Flood", region: "Test", startDate: "2026-11-01", endDate: "2026-12-31", budgetCents: 500000, communityIds: ["com_north_ridge"], categories: ["drinking_water"], status: "draft" } });
    expect(created.status).toBe(201);
    const id = created.json.program.id;
    expect((await t.call("POST", `/api/programs/${id}/status`, { cookie: c, body: { status: "paused" } })).status).toBe(409);
    expect((await t.call("POST", `/api/programs/${id}/status`, { cookie: c, body: { status: "active" } })).status).toBe(200);
    expect((await t.call("POST", `/api/programs/${id}/status`, { cookie: c, body: { status: "closed" } })).status).toBe(200);
    expect((await t.call("PATCH", `/api/programs/${id}`, { cookie: c, body: { name: "x y z" } })).status).toBe(409);
    expect((await t.call("PATCH", "/api/programs/prog_pine_valley", { cookie: c, body: { budgetCents: 100 } })).json.error.code).toBe("budget_below_committed");
    expect((await t.call("POST", "/api/programs", { cookie: c, body: { name: "Bad", emergencyType: "Flood", region: "X", startDate: "2026-12-01", endDate: "2026-11-01", budgetCents: 100, communityIds: ["com_north_ridge"], categories: ["drinking_water"] } })).status).toBe(400);
    const audit = (await t.call("GET", `/api/audit?programId=${id}`, { cookie: c })).json.items.map((x: any) => x.action);
    expect(audit).toEqual(expect.arrayContaining(["program.created", "program.activated", "program.closed"]));
  });

  it("closing a program blocks redemption", async () => {
    const c = await t.login("coordinator");
    const m = await t.login("merchant", "usr_mer_1004");
    const r = await t.login("resident", "usr_res_1005");
    await t.call("POST", "/api/programs/prog_pine_valley/status", { cookie: c, body: { status: "paused" } });
    const v = (await t.call("GET", "/api/resident/vouchers", { cookie: r })).json.items[0];
    const item = (await t.call("GET", "/api/merchant/products", { cookie: m })).json.items[0];
    const res = await t.call("POST", "/api/merchant/terminal/redeem", { cookie: m, body: { token: v.token, items: [{ inventoryItemId: item.id, quantity: 1 }], idempotencyKey: crypto.randomUUID() } });
    expect(res.status).toBe(422);
    expect(res.json.error.details.issues.map((i: any) => i.code)).toContain("program_inactive");
  });

  it("mutating requests require the client header and a same-origin Origin", async () => {
    const c = await t.login("coordinator");
    expect((await t.call("POST", "/api/auth/logout", { cookie: c, headers: { "x-relay-client": "" } })).status).toBe(403);
    expect((await t.call("POST", "/api/auth/demo", { body: { role: "coordinator" }, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("logout invalidates the session", async () => {
    const c = await t.login("coordinator");
    expect((await t.call("GET", "/api/programs", { cookie: c })).status).toBe(200);
    await t.call("POST", "/api/auth/logout", { cookie: c, body: {} });
    expect((await t.call("GET", "/api/programs", { cookie: c })).status).toBe(401);
  });

  it("expired sessions are rejected", async () => {
    const c = await t.login("coordinator");
    t.clock.now = new Date("2026-11-13T16:00:00.000Z");
    expect((await t.call("GET", "/api/programs", { cookie: c })).status).toBe(401);
  });

  it("seeded demo data reconciles", () => {
    const q = (s: string) => t.db.raw.prepare(s).get() as any;
    const a = q("SELECT (SELECT SUM(amount_cents) FROM ledger_entries WHERE account_type='resident') l, (SELECT SUM(remaining_cents) FROM vouchers) v");
    expect(a.l).toBe(a.v);
    const b = q("SELECT (SELECT SUM(amount_cents) FROM ledger_entries WHERE account_type='merchant') l, (SELECT SUM(amount_cents) FROM reimbursement_claims WHERE status IN ('pending','approved')) c");
    expect(b.l).toBe(b.c);
    expect(q("SELECT COUNT(*) n FROM inventory_items i WHERE quantity <> (SELECT COALESCE(SUM(delta),0) FROM inventory_movements m WHERE m.inventory_item_id = i.id)").n).toBe(0);
    expect(q("SELECT COUNT(*) n FROM reimbursement_claims c WHERE amount_cents <> (SELECT COALESCE(SUM(amount_cents),0) FROM reimbursement_items ri WHERE ri.claim_id = c.id AND ri.voided = 0)").n).toBe(0);
    expect(q("SELECT COUNT(*) n FROM vouchers v WHERE amount_cents - remaining_cents <> (SELECT COALESCE(SUM(amount_cents),0) FROM redemptions r WHERE r.voucher_id = v.id AND r.status = 'completed')").n).toBe(0);
  });
});
