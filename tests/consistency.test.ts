import { describe, expect, it } from "vitest";
import { analyze } from "../shared/engine";
import { stockoutMarker } from "../shared/forecast";
import { buildSeed } from "../scripts/seed-data";
import { NOW, setup } from "./helpers/app";

const seed = buildSeed(NOW);

describe("one calculation path across every surface", () => {
  it("overview, communities, intelligence and the public preview report identical viability and mix", async () => {
    const t = setup();
    const co = await t.login("coordinator");
    const programs = (await t.call("GET", "/api/programs", { cookie: co })).json.items;
    const pv = programs.find((p: any) => p.name === "Pine Valley Wildfire Response");
    const engine = analyze(seed.snapshot);

    const overview = (await t.call("GET", `/api/overview?programId=${pv.id}`, { cookie: co })).json;
    const comms = (await t.call("GET", `/api/communities?programId=${pv.id}`, { cookie: co })).json.items;
    const live = (await t.call("GET", `/api/intelligence/live?programId=${pv.id}`, { cookie: co })).json.analysis;
    const pub = (await t.call("GET", "/api/public/preview")).json;

    for (const e of engine.communities) {
      const ov = overview.communities.find((c: any) => c.communityId === e.communityId);
      const cm = comms.find((c: any) => c.id === e.communityId).live;
      const lv = live.communities.find((c: any) => c.communityId === e.communityId);
      const pb = pub.communities.find((c: any) => c.name === e.name);
      for (const v of [ov.marketViability, cm.marketViability, lv.marketViability, pb.viability]) expect(v).toBeCloseTo(e.marketViability, 10);
      for (const v of [cm.voucherPct, lv.voucherPct, pb.voucherPct]) expect(v).toBeCloseTo(e.voucherPct, 10);
      expect(cm.recommendedCents).toBe(e.recommendedCents);
      expect(lv.recommendedCents).toBe(e.recommendedCents);
      expect(cm.inventoryCoverage).toBeCloseTo(e.inventoryCoverage, 10);
      expect(lv.inventoryCoverage).toBeCloseTo(e.inventoryCoverage, 10);
    }
  });

  it("recommendations are exact in cents and procurement estimates never exceed the direct-supply budget", () => {
    const r = analyze(seed.snapshot);
    let sum = 0;
    for (const c of r.communities) {
      expect(Number.isInteger(c.recommendedCents)).toBe(true);
      expect(c.voucherCents + c.directCents).toBe(c.recommendedCents);
      expect(c.procurement.budgetCents).toBe(c.directCents);
      expect(c.procurement.allocatedCents).toBeLessThanOrEqual(c.directCents);
      expect(c.procurement.allocatedCents + c.procurement.unallocatedCents).toBe(c.directCents);
      for (const l of c.procurement.lines) { expect(l.units).toBeGreaterThanOrEqual(0); expect(l.units).toBeLessThanOrEqual(l.shortageUnits); }
      sum += c.recommendedCents;
    }
    expect(sum).toBeLessThanOrEqual(r.budgetBasisCents);
    expect(sum).toBe(r.totals.recommendedCents);
  });

  it("a saved analysis run stores exactly what the live engine calculated", async () => {
    const t = setup();
    const co = await t.login("coordinator");
    const pv = (await t.call("GET", "/api/programs", { cookie: co })).json.items.find((p: any) => p.name === "Pine Valley Wildfire Response");
    const run = await t.call("POST", "/api/intelligence/run", { cookie: co, body: { programId: pv.id, analysisDays: 30 } });
    expect(run.status).toBe(201);
    const detail = (await t.call("GET", `/api/allocations/${run.json.runId}`, { cookie: co })).json;
    const engine = analyze(seed.snapshot);
    for (const e of engine.communities) {
      const rec = detail.recommendations.find((c: any) => c.communityId === e.communityId);
      expect(rec.marketViability).toBeCloseTo(e.marketViability, 10);
      expect(rec.recommendedCents).toBe(e.recommendedCents);
      expect(rec.voucherCents).toBe(e.voucherCents);
    }
  });
});

describe("program residents are scoped to their program", () => {
  it("the residents endpoint only returns residents registered to the requested program", async () => {
    const t = setup();
    const co = await t.login("coordinator");
    const programs = (await t.call("GET", "/api/programs", { cookie: co })).json.items;
    let total = 0;
    for (const p of programs) {
      const res = (await t.call("GET", `/api/residents?programId=${p.id}&pageSize=100`, { cookie: co })).json;
      const ids = res.items.map((r: any) => r.id);
      const inDb = t.db.raw.prepare("SELECT id FROM residents WHERE program_id = ?").all(p.id).map((r: any) => r.id);
      expect([...ids].sort()).toEqual([...inDb].sort());
      total += res.total;
    }
    expect(total).toBe((t.db.raw.prepare("SELECT COUNT(*) n FROM residents").get() as any).n);
  });

  it("search narrows results within the program and balance = issued - redeemed", async () => {
    const t = setup();
    const co = await t.login("coordinator");
    const pv = (await t.call("GET", "/api/programs", { cookie: co })).json.items.find((p: any) => p.name === "Pine Valley Wildfire Response");
    const all = (await t.call("GET", `/api/residents?programId=${pv.id}&pageSize=100`, { cookie: co })).json.items;
    const target = all[0];
    const hit = (await t.call("GET", `/api/residents?programId=${pv.id}&q=${encodeURIComponent(target.name)}`, { cookie: co })).json.items;
    expect(hit.some((r: any) => r.id === target.id)).toBe(true);
    expect(hit.length).toBeLessThanOrEqual(all.length);
    for (const r of all) expect(r.balanceCents).toBe(r.issuedCents - r.redeemedCents);
  });
});

describe("stockout marker", () => {
  it("is only produced for a real stockout inside the displayed horizon", () => {
    expect(stockoutMarker(null, 3)).toBeNull();
    expect(stockoutMarker(undefined, 3)).toBeNull();
    expect(stockoutMarker(Number.NaN, 3)).toBeNull();
    expect(stockoutMarker(-1, 3)).toBeNull();
    expect(stockoutMarker(100, 3)).toBeNull(); // 4.17 days is outside a 3 day window
    expect(stockoutMarker(36, 3)).toEqual({ days: 1.5, now: false });
    expect(stockoutMarker(0, 3)).toEqual({ days: 0, now: true });
    expect(stockoutMarker(10, 0)).toBeNull();
  });

  it("the engine's stockout hours always fall inside the 72 hour horizon", () => {
    for (const c of analyze(seed.snapshot).communities) for (const k of c.categories) {
      if (k.stockoutHours !== null) { expect(k.stockoutHours).toBeGreaterThanOrEqual(0); expect(k.stockoutHours).toBeLessThan(72); }
    }
  });
});
