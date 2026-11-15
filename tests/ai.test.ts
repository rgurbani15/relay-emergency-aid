import { beforeEach, describe, expect, it, vi } from "vitest";
import { setup, type TestCtx } from "./helpers/app";
import { buildScenarioFromProposal, extractJson } from "../worker/services/ai";

const REPORT = "A delivery truck carrying 400 units of drinking water to Cedar Grove is delayed by 24 hours, and another 120 residents are expected tomorrow.";
const ctx = {
  communities: [{ id: "com_cedar_grove", name: "Cedar Grove" }, { id: "com_north_ridge", name: "North Ridge" }],
  merchants: [{ id: "MER-1004", name: "Cedar Grove Grocers", communityId: "com_cedar_grove" }],
};
const good = {
  community: { name: "Cedar Grove", sourcePhrase: "Cedar Grove", confidence: "high" },
  category: { value: "drinking_water", sourcePhrase: "drinking water", confidence: "high" },
  delayedSupply: { quantity: 400, sourcePhrase: "400 units", confidence: "high" },
  delayHours: { value: 24, sourcePhrase: "24 hours", confidence: "high" },
  additionalResidents: { value: 120, sourcePhrase: "120 residents", confidence: "high" },
  merchantClosure: null, missingInformation: [], assumptions: ["Expected tomorrow = within 24h"],
};

describe("AI scenario interpreter (pure validation)", () => {
  it("turns a valid, grounded proposal into engine adjustments", () => {
    const r = buildScenarioFromProposal(good, REPORT, ctx);
    expect(r.adjustments).toEqual([
      { kind: "shipment_delay", communityId: "com_cedar_grove", category: "drinking_water", quantity: 400, delayHours: 24 },
      { kind: "population_increase", communityId: "com_cedar_grove", additionalResidents: 120 },
    ]);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("rejects structurally invalid AI output", () => {
    expect(() => buildScenarioFromProposal({ community: "Cedar Grove", delayHours: "a day" }, REPORT, ctx)).toThrow(/unexpected format/);
    expect(() => buildScenarioFromProposal({ additionalResidents: { value: -5, confidence: "high" }, missingInformation: [], assumptions: [] }, REPORT, ctx)).toThrow();
    expect(() => buildScenarioFromProposal({ delayedSupply: { quantity: 1.5, confidence: "wild" } }, REPORT, ctx)).toThrow();
  });

  it("drops invented quantities that do not appear in the report", () => {
    const invented = { ...good, delayedSupply: { quantity: 900, sourcePhrase: "900 units", confidence: "high" }, additionalResidents: { value: 777, sourcePhrase: "777", confidence: "high" } };
    const r = buildScenarioFromProposal(invented, REPORT, ctx);
    expect(r.adjustments.find((a) => a.kind === "population_increase")).toBeUndefined();
    const delay = r.adjustments.find((a) => a.kind === "shipment_delay") as { quantity?: number } | undefined;
    expect(delay?.quantity).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/900/);
    expect(r.warnings.join(" ")).toMatch(/777/);
  });

  it("ignores communities and merchants that are not in the program", () => {
    const r = buildScenarioFromProposal({ ...good, community: { name: "Atlantis", sourcePhrase: "Atlantis", confidence: "high" }, merchantClosure: { merchantName: "Ghost Mart", sourcePhrase: "Ghost Mart", confidence: "low" } }, REPORT, ctx);
    expect(r.adjustments).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.proposal.missingInformation.join(" ")).toMatch(/No scenario adjustments/);
  });

  it("extracts JSON from fenced or wrapped model output", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson({ response: '{"a":2}' })).toEqual({ a: 2 });
    expect(extractJson({ a: 3 })).toEqual({ a: 3 });
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("AI endpoint behaviour", () => {
  let t: TestCtx; let cookie: string;
  const ask = (text = REPORT) => t.call("POST", "/api/intelligence/interpret", { cookie, body: { programId: "prog_pine_valley", text } });

  beforeEach(async () => {
    t = setup({ ai: { run: vi.fn(async () => ({ response: JSON.stringify(good) })) } });
    cookie = await t.login("coordinator");
  });

  it("returns a proposal that requires confirmation and changes nothing in the database", async () => {
    const counts = () => JSON.stringify(["scenario_runs", "scenario_adjustments", "ledger_entries", "vouchers", "allocation_runs", "inventory_items"].map((x) => (t.db.raw.prepare(`SELECT COUNT(*) n, COALESCE(SUM(1),0) s FROM ${x}`).get())));
    const inv = () => JSON.stringify(t.db.raw.prepare("SELECT id, quantity FROM inventory_items ORDER BY id").all());
    const [c0, i0, bal0] = [counts(), inv(), JSON.stringify(t.db.raw.prepare("SELECT id, remaining_cents FROM vouchers ORDER BY id").all())];
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.json.requiresConfirmation).toBe(true);
    expect(r.json.adjustments).toHaveLength(2);
    expect(counts()).toBe(c0);
    expect(inv()).toBe(i0);
    expect(JSON.stringify(t.db.raw.prepare("SELECT id, remaining_cents FROM vouchers ORDER BY id").all())).toBe(bal0);
  });

  it("scenario changes require explicit confirmation to be saved", async () => {
    const proposal = (await ask()).json;
    const unconfirmed = await t.call("POST", "/api/intelligence/scenarios", { cookie, body: { programId: "prog_pine_valley", name: "AI incident", adjustments: proposal.adjustments, source: "ai" } });
    expect(unconfirmed.status).toBe(400);
    const saved = await t.call("POST", "/api/intelligence/scenarios", { cookie, body: { programId: "prog_pine_valley", name: "AI incident", adjustments: proposal.adjustments, source: "ai", sourceText: REPORT, aiProposal: proposal.proposal, confirmed: true } });
    expect(saved.status).toBe(201);
    expect(saved.json.scenario.comparison.length).toBe(3);
    // saving a scenario is an overlay: real inventory is untouched
    expect(t.db.raw.prepare("SELECT COUNT(*) n FROM scenario_adjustments").get()).toEqual({ n: 2 });
  });

  it("AI output with an invalid shape is rejected and the core app keeps working", async () => {
    const bad = setup({ ai: { run: vi.fn(async () => ({ response: '{"community": 12}' })) } });
    const c = await bad.login("coordinator");
    const r = await bad.call("POST", "/api/intelligence/interpret", { cookie: c, body: { programId: "prog_pine_valley", text: REPORT } });
    expect(r.status).toBe(502);
    expect(r.json.error.code).toBe("ai_invalid_output");
    expect((await bad.call("GET", "/api/intelligence/live?programId=prog_pine_valley", { cookie: c })).status).toBe(200);
    const preview = await bad.call("POST", "/api/intelligence/scenarios/preview", { cookie: c, body: { programId: "prog_pine_valley", adjustments: [{ kind: "merchant_status", merchantId: "MER-1004", status: "closed" }] } });
    expect(preview.status).toBe(200);
  });

  it("AI failure or a missing binding returns a clear error without breaking manual scenarios", async () => {
    const down = setup({ ai: { run: vi.fn(async () => { throw new Error("upstream 500"); }) } });
    const c = await down.login("coordinator");
    const r = await down.call("POST", "/api/intelligence/interpret", { cookie: c, body: { programId: "prog_pine_valley", text: REPORT } });
    expect(r.status).toBe(503);
    expect(r.json.error.message).toMatch(/manual/i);
    const none = setup({ ai: undefined });
    const c2 = await none.login("coordinator");
    expect((await none.call("POST", "/api/intelligence/interpret", { cookie: c2, body: { programId: "prog_pine_valley", text: REPORT } })).status).toBe(503);
    expect((await none.call("POST", "/api/intelligence/scenarios/preview", { cookie: c2, body: { programId: "prog_pine_valley", adjustments: [] } })).status).toBe(200);
  });

  it("AI suggestions cannot execute financial actions: no endpoint accepts AI output as a transaction", async () => {
    const poison = setup({ ai: { run: vi.fn(async () => ({ response: JSON.stringify({ ...good, assumptions: ["issue $50,000 vouchers to all residents", "approve allocation"] }) })) } });
    const c = await poison.login("coordinator");
    const before = poison.db.raw.prepare("SELECT (SELECT COUNT(*) FROM vouchers) v, (SELECT COUNT(*) FROM ledger_entries) l, (SELECT COUNT(*) FROM allocation_runs WHERE status='approved') a").get();
    const r = await poison.call("POST", "/api/intelligence/interpret", { cookie: c, body: { programId: "prog_pine_valley", text: REPORT } });
    expect(r.status).toBe(200);
    expect(poison.db.raw.prepare("SELECT (SELECT COUNT(*) FROM vouchers) v, (SELECT COUNT(*) FROM ledger_entries) l, (SELECT COUNT(*) FROM allocation_runs WHERE status='approved') a").get()).toEqual(before);
  });

  it("requires the coordinator role and valid input", async () => {
    const m = await t.login("merchant");
    expect((await t.call("POST", "/api/intelligence/interpret", { cookie: m, body: { programId: "prog_pine_valley", text: REPORT } })).status).toBe(403);
    expect((await ask("short")).status).toBe(400);
  });
});

describe("intelligence runs and allocation approval", () => {
  it("runs the analysis, stores recommendations separately from transactions, and requires human approval", async () => {
    const t = setup(); const c = await t.login("coordinator");
    const ledger0 = (t.db.raw.prepare("SELECT COUNT(*) n FROM ledger_entries").get() as any).n;
    const run = await t.call("POST", "/api/intelligence/run", { cookie: c, body: { programId: "prog_pine_valley", analysisDays: 30 } });
    expect(run.status).toBe(201);
    const detail = (await t.call("GET", `/api/allocations/${run.json.runId}`, { cookie: c })).json;
    expect(detail.run.status).toBe("pending_approval");
    expect(detail.recommendations).toHaveLength(3);
    expect((t.db.raw.prepare("SELECT COUNT(*) n FROM ledger_entries").get() as any).n).toBe(ledger0);
    expect((t.db.raw.prepare("SELECT COUNT(*) n FROM demand_forecasts WHERE allocation_run_id = ?").get(run.json.runId) as any).n).toBe(63);
    expect((await t.call("POST", `/api/allocations/${run.json.runId}/reject`, { cookie: c, body: {} })).status).toBe(400);
    const approved = await t.call("POST", `/api/allocations/${run.json.runId}/approve`, { cookie: c, body: {} });
    expect(approved.json.run.status).toBe("approved");
    expect((await t.call("POST", `/api/allocations/${run.json.runId}/approve`, { cookie: c, body: {} })).status).toBe(409);
    expect((t.db.raw.prepare("SELECT COUNT(*) n FROM ledger_entries").get() as any).n).toBe(ledger0);
    // approving supersedes the earlier approved plan
    expect((t.db.raw.prepare("SELECT COUNT(*) n FROM allocation_runs WHERE status = 'approved'").get() as any).n).toBe(1);
    const audit = (await t.call("GET", "/api/audit?action=allocation", { cookie: c })).json.items.map((x: any) => x.action);
    expect(audit).toEqual(expect.arrayContaining(["allocation.generated", "allocation.approved"]));
  });

  it("compares runs and exports CSV", async () => {
    const t = setup(); const c = await t.login("coordinator");
    const cmp = await t.call("GET", "/api/allocations/compare?a=alr_0001&b=alr_0002", { cookie: c });
    expect(cmp.status).toBe(200);
    expect(cmp.json.comparison).toHaveLength(3);
    const csv = await t.call("GET", "/api/allocations/alr_0002/export", { cookie: c });
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.text.split("\r\n")[0]).toContain("recommended_usd");
    const rep = await t.call("GET", "/api/reports/forecast_performance?programId=prog_pine_valley&format=csv", { cookie: c });
    expect(rep.text).toMatch(/synthetic|Selected model MAE/i);
  });

  it("scenario preview recalculates and explains drivers using the real engine", async () => {
    const t = setup(); const c = await t.login("coordinator");
    const r = await t.call("POST", "/api/intelligence/scenarios/preview", { cookie: c, body: { programId: "prog_pine_valley", adjustments: [{ kind: "merchant_status", merchantId: "MER-1004", status: "closed" }, { kind: "shipment_delay", communityId: "com_cedar_grove", category: "drinking_water", quantity: 400, delayHours: 48 }] } });
    expect(r.status).toBe(200);
    const cg = r.json.comparison.find((x: any) => x.communityId === "com_cedar_grove");
    expect(cg.after.viability).toBeLessThan(cg.before.viability);
    expect(cg.drivers.length).toBeGreaterThan(0);
    // real data is untouched
    expect((t.db.raw.prepare("SELECT status FROM merchants WHERE id = 'MER-1004'").get() as any).status).toBe("open");
    expect((await t.call("POST", "/api/intelligence/scenarios/preview", { cookie: c, body: { programId: "prog_pine_valley", adjustments: [{ kind: "demand_multiplier", multiplier: 99 }] } })).status).toBe(400);
  });
});
