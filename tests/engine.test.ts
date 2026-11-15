import { describe, expect, it } from "vitest";
import { distributeBudget, effectiveCapacity, marketViability, merchantCoverage, planProcurement, priorityShares, voucherShare, maxEligibleNeedCents } from "../shared/allocation";
import { analyze, compareAnalyses, type EngineSnapshot } from "../shared/engine";
import { splitCents } from "../shared/money";
import { buildSeed } from "../scripts/seed-data";

const seed = buildSeed("2026-11-12T16:00:00.000Z");

describe("market-aware allocation engine", () => {
  it("high market viability produces a higher voucher share than low viability", () => {
    expect(voucherShare(0.9)).toBeGreaterThan(voucherShare(0.2));
    expect(voucherShare(0.9)).toBeLessThanOrEqual(0.85);
    expect(voucherShare(0)).toBe(0.1);
    expect(marketViability(1, 1, 1)).toBeCloseTo(1, 10);
    expect(marketViability(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("viability formula uses the documented weights", () => {
    expect(marketViability(0.8, 0.6, 0.5)).toBeCloseTo(0.35 * 0.8 + 0.25 * 0.6 + 0.4 * 0.5, 10);
  });

  it("seed communities get strong / mixed / weak recommendations", () => {
    const r = analyze(seed.snapshot);
    const by = Object.fromEntries(r.communities.map((c) => [c.name, c]));
    expect(by["North Ridge"].voucherPct).toBeGreaterThan(by["Cedar Grove"].voucherPct);
    expect(by["Cedar Grove"].voucherPct).toBeGreaterThan(by["East Valley"].voucherPct);
    expect(by["North Ridge"].action).toBe("vouchers");
    expect(by["Cedar Grove"].action).toBe("mixed");
    expect(by["East Valley"].action).toBe("direct_supply");
  });

  it("never exceeds the budget, never allocates negative amounts, and splits are exact in cents", () => {
    const r = analyze(seed.snapshot);
    const sum = r.communities.reduce((s, c) => s + c.recommendedCents, 0);
    expect(sum + r.totals.unallocatedCents).toBe(r.budgetBasisCents);
    expect(sum).toBeLessThanOrEqual(r.budgetBasisCents);
    for (const c of r.communities) {
      expect(c.recommendedCents).toBeGreaterThanOrEqual(0);
      expect(c.voucherCents + c.directCents).toBe(c.recommendedCents);
      expect(Number.isInteger(c.voucherCents)).toBe(true);
    }
  });

  it("integer-cent rounding: largest remainder preserves totals", () => {
    expect(splitCents(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitCents(1, [5, 3, 2]).reduce((a, b) => a + b, 0)).toBe(1);
    expect(splitCents(0, [1, 2])).toEqual([0, 0]);
    expect(splitCents(7, [0, 0])).toEqual([4, 3]);
  });

  it("caps are respected and the excess is redistributed", () => {
    const d = distributeBudget(10_000, [0.5, 0.3, 0.2], [1_000, 100_000, 100_000]);
    expect(d.allocations[0]).toBe(1_000);
    expect(d.allocations.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(d.allocations[1] / d.allocations[2]).toBeCloseTo(1.5, 1);
    expect(d.capped).toContain(0);
  });

  it("reports unallocated budget when every community is capped", () => {
    const d = distributeBudget(10_000, [0.5, 0.5], [1_000, 2_000]);
    expect(d.allocations).toEqual([1_000, 2_000]);
    expect(d.unallocatedCents).toBe(7_000);
  });

  it("regional priority responds to need and shortage", () => {
    const base = [
      { populationNeeding: 1000, needSeverity: 50, deficitValueCents: 0 },
      { populationNeeding: 1000, needSeverity: 50, deficitValueCents: 0 },
    ];
    expect(priorityShares(base)[0]).toBeCloseTo(0.5, 10);
    const moreSevere = [{ ...base[0], needSeverity: 90 }, base[1]];
    expect(priorityShares(moreSevere)[0]).toBeGreaterThan(0.5);
    const shortage = [base[0], { ...base[1], deficitValueCents: 500_000 }];
    expect(priorityShares(shortage)[1]).toBeGreaterThan(0.5);
    expect(priorityShares(shortage).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(maxEligibleNeedCents(1000, 50, 0)).toBe(25_00 * 1000);
  });

  it("changing a community's inventory changes its recommendation (engine reads inventory)", () => {
    const base = analyze(seed.snapshot);
    const snap: EngineSnapshot = structuredClone(seed.snapshot);
    snap.inventory.filter((i) => i.communityId === "com_north_ridge").forEach((i) => (i.quantity = 0));
    const after = analyze(snap);
    const b = base.communities.find((c) => c.communityId === "com_north_ridge")!;
    const a = after.communities.find((c) => c.communityId === "com_north_ridge")!;
    expect(a.marketViability).toBeLessThan(b.marketViability);
    expect(a.voucherPct).toBeLessThan(b.voucherPct);
  });
});

describe("scenario simulator", () => {
  const closure = [{ kind: "merchant_status", merchantId: "MER-1004", status: "closed" }] as const;

  it("a merchant closure removes its inventory and capacity from viability", () => {
    const before = analyze(seed.snapshot);
    const after = analyze(seed.snapshot, [...closure]);
    const b = before.communities.find((c) => c.communityId === "com_cedar_grove")!;
    const a = after.communities.find((c) => c.communityId === "com_cedar_grove")!;
    expect(a.merchantCapacity).toBeLessThan(b.merchantCapacity);
    expect(a.inventoryUnits).toBeLessThan(b.inventoryUnits);
    expect(a.marketViability).toBeLessThan(b.marketViability);
    const cmp = compareAnalyses(before, after).find((x) => x.communityId === "com_cedar_grove")!;
    expect(cmp.drivers.length).toBeGreaterThan(0);
    expect(cmp.after.viability).toBeLessThan(cmp.before.viability);
  });

  it("a shipment delay worsens a time-phased shortage, and other communities are unaffected", () => {
    const before = analyze(seed.snapshot);
    const after = analyze(seed.snapshot, [{ kind: "shipment_delay", communityId: "com_cedar_grove", category: "drinking_water", quantity: 400, delayHours: 48 }]);
    const w = (r: typeof before) => r.communities.find((c) => c.communityId === "com_cedar_grove")!.categories.find((x) => x.category === "drinking_water")!;
    expect(w(after).unmetUnits).toBeGreaterThanOrEqual(w(before).unmetUnits);
    expect(after.communities.find((c) => c.communityId === "com_north_ridge")!.marketViability).toBeCloseTo(before.communities.find((c) => c.communityId === "com_north_ridge")!.marketViability, 10);
  });

  it("population increase raises demand; scenarios never mutate the source snapshot", () => {
    const frozen = JSON.stringify(seed.snapshot);
    const before = analyze(seed.snapshot);
    const after = analyze(seed.snapshot, [{ kind: "population_increase", communityId: "com_cedar_grove", additionalResidents: 500 }]);
    expect(after.communities.find((c) => c.communityId === "com_cedar_grove")!.demand72Units).toBeGreaterThan(before.communities.find((c) => c.communityId === "com_cedar_grove")!.demand72Units);
    expect(JSON.stringify(seed.snapshot)).toBe(frozen);
  });
});

describe("merchant coverage and viability", () => {
  const cedar = (r: ReturnType<typeof analyze>) => r.communities.find((c) => c.communityId === "com_cedar_grove")!;
  const closeAll = (communityId: string, keep: number) => {
    const snap: EngineSnapshot = structuredClone(seed.snapshot);
    snap.merchants.filter((m) => m.communityId === communityId).forEach((m, i) => { if (i >= keep) m.status = "closed"; });
    return snap;
  };

  it("coverage = min(1, operating equivalents / needed) and effective capacity = average x coverage", () => {
    expect(merchantCoverage(2, 4)).toBe(0.5);
    expect(merchantCoverage(6, 4)).toBe(1);
    expect(merchantCoverage(0, 0)).toBe(0);
    expect(effectiveCapacity(0.8, 0.5)).toBeCloseTo(0.4, 10);
    const c = cedar(analyze(seed.snapshot));
    expect(c.merchantCoverageRatio).toBeCloseTo(Math.min(1, c.operatingEquivalent / c.merchantsNeeded), 10);
    expect(c.merchantCapacity).toBeCloseTo(c.averageCapacity * c.merchantCoverageRatio, 0);
  });

  it("closing merchants decreases coverage", () => {
    const before = cedar(analyze(seed.snapshot));
    const after = cedar(analyze(closeAll("com_cedar_grove", 1)));
    expect(after.merchantCoverageRatio).toBeLessThan(before.merchantCoverageRatio);
    expect(after.operatingMerchants).toBeLessThan(before.operatingMerchants);
  });

  it("low coverage reduces viability even when inventory and access are unchanged", () => {
    const base = structuredClone(seed.snapshot);
    base.merchants.filter((m) => m.communityId === "com_north_ridge").forEach((m) => (m.status = "open"));
    const need = base.communities.find((c) => c.id === "com_north_ridge")!;
    const high = analyze({ ...base, communities: base.communities.map((c) => (c.id === need.id ? { ...c, merchantsNeeded: 1 } : c)) });
    const low = analyze({ ...base, communities: base.communities.map((c) => (c.id === need.id ? { ...c, merchantsNeeded: 40 } : c)) });
    const h = high.communities.find((c) => c.communityId === need.id)!, l = low.communities.find((c) => c.communityId === need.id)!;
    expect(l.merchantCoverageRatio).toBeLessThan(h.merchantCoverageRatio);
    expect(l.inventoryCoverage).toBeCloseTo(h.inventoryCoverage, 10);
    expect(l.marketViability).toBeLessThan(h.marketViability);
  });

  it("inventory shortages reduce viability", () => {
    const snap = structuredClone(seed.snapshot);
    snap.inventory.filter((i) => i.communityId === "com_cedar_grove" && i.category === "drinking_water").forEach((i) => (i.quantity = 0));
    expect(cedar(analyze(snap)).marketViability).toBeLessThan(cedar(analyze(seed.snapshot)).marketViability);
  });

  it("strong markets get a higher voucher recommendation; weak markets a higher direct-supply recommendation", () => {
    const r = analyze(seed.snapshot);
    const strong = [...r.communities].sort((a, b) => b.marketViability - a.marketViability);
    expect(strong[0].voucherPct).toBeGreaterThan(strong[strong.length - 1].voucherPct);
    expect(strong[strong.length - 1].directPct).toBeGreaterThan(strong[0].directPct);
    expect(strong[strong.length - 1].directPct).toBeGreaterThan(0.5);
  });
});

describe("direct-supply procurement reconciliation", () => {
  const scenarios = [
    analyze(seed.snapshot),
    analyze(seed.snapshot, [{ kind: "merchant_status", merchantId: "MER-1004", status: "closed" }, { kind: "shipment_delay", communityId: "com_cedar_grove", category: "drinking_water", delayHours: 48 }]),
    analyze(seed.snapshot, [{ kind: "demand_multiplier", multiplier: 4 }]),
  ];

  it("allocated + unallocated equals the direct-supply budget; no negatives; never above shortages", () => {
    for (const r of scenarios) for (const c of r.communities) {
      const p = c.procurement;
      expect(p.budgetCents).toBe(c.directCents);
      expect(p.allocatedCents + p.unallocatedCents).toBe(c.directCents);
      expect(p.allocatedCents).toBe(p.lines.reduce((s, l) => s + l.costCents, 0));
      expect(p.estimate).toBe(true);
      for (const l of p.lines) {
        expect(l.units).toBeGreaterThanOrEqual(0);
        expect(l.costCents).toBe(l.units * l.unitCostCents);
        expect(l.units).toBeLessThanOrEqual(l.shortageUnits);
        expect(l.unfundedUnits).toBe(l.shortageUnits - l.units);
      }
    }
  });

  it("budget larger than shortages leaves the remainder unallocated; smaller budgets fund by priority", () => {
    const plan = planProcurement(1_000_000, [{ category: "a", label: "A", shortageUnits: 10, unitCostCents: 100, priority: 1 }]);
    expect(plan.allocatedCents).toBe(1000);
    expect(plan.unallocatedCents).toBe(999_000);
    const tight = planProcurement(1_050, [
      { category: "low", label: "Low", shortageUnits: 10, unitCostCents: 100, priority: 0.1 },
      { category: "high", label: "High", shortageUnits: 8, unitCostCents: 100, priority: 0.9 },
    ]);
    expect(tight.lines[0].category).toBe("high");
    expect(tight.lines[0].units).toBe(8);
    expect(tight.lines[1].units).toBe(2);
    expect(tight.unallocatedCents).toBe(50);
    expect(planProcurement(0, [{ category: "a", label: "A", shortageUnits: 5, unitCostCents: 100, priority: 1 }]).allocatedCents).toBe(0);
    expect(planProcurement(500, []).unallocatedCents).toBe(500);
  });
});

describe("public landing preview", () => {
  it("is unauthenticated, derived from the shared engine, and exposes no personal data", async () => {
    const { setup } = await import("./helpers/app");
    const t = setup();
    const res = await t.call("GET", "/api/public/preview");
    expect(res.status).toBe(200);
    const engine = analyze(seed.snapshot);
    for (const c of engine.communities) {
      const p = res.json.communities.find((x: { name: string }) => x.name === c.name);
      expect(p.viability).toBeCloseTo(c.marketViability, 10);
      expect(p.voucherPct).toBeCloseTo(c.voucherPct, 10);
    }
    expect(res.text).not.toMatch(/okafor|@|balance/i);
  });
});
