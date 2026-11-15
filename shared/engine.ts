import { CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS, ENGINE, categoryLabel, type Category } from "./constants";
import { ACTION_LABEL, actionFor, distributeBudget, effectiveCapacity, marketViability, merchantCoverage, planProcurement, type ProcurementPlan, maxEligibleNeedCents, priorityShares, riskStatus, voucherShare } from "./allocation";
import {
  baselineForecast, evaluate, forecastDailyDemand, mergeErrors, rollingHoldout, simulateSupply,
  type ForecastEvaluation, type ForecastErrors,
} from "./forecast";
import { splitCents } from "./money";

/* ---------- Snapshot (pure data the engine works on; assembled from D1 on the server) ---------- */

export type MerchantStatus = "open" | "limited" | "closed";
export interface SnapCommunity {
  id: string; name: string; populationNeeding: number; needSeverity: number; marketAccess: number;
  merchantsNeeded: number; diagramX?: number; diagramY?: number;
}
export interface SnapMerchant { id: string; communityId: string; name: string; status: MerchantStatus; capacityScore: number; participating: boolean }
export interface SnapInventory { id: string; merchantId: string; communityId: string; category: Category; quantity: number; unitPriceCents: number; name: string }
export interface SnapShipment { id: string; communityId: string; category: Category; quantity: number; etaHours: number; label: string }
export interface EngineSnapshot {
  asOf: string;
  program: { id: string; name: string; budgetCents: number; committedCents: number };
  communities: SnapCommunity[];
  merchants: SnapMerchant[];
  inventory: SnapInventory[];
  shipments: SnapShipment[];
  /** Daily consumption history keyed `${communityId}|${category}`, oldest -> newest. */
  history: Record<string, number[]>;
}

/* ---------- Scenario adjustments ---------- */

export type Adjustment =
  | { kind: "merchant_status"; merchantId: string; status: MerchantStatus }
  | { kind: "shipment_delay"; communityId: string; category?: Category; quantity?: number; delayHours: number }
  | { kind: "population_increase"; communityId: string; additionalResidents: number }
  | { kind: "inventory_change"; communityId: string; category: Category; mode: "reduce_percent" | "set_units" | "delta_units"; value: number }
  | { kind: "demand_multiplier"; communityId?: string; category?: Category; multiplier: number };

export interface AppliedSnapshot {
  snapshot: EngineSnapshot;
  demandMultiplier: Record<string, number>;
  notes: string[];
}

const key = (c: string, cat: string) => `${c}|${cat}`;

export function applyAdjustments(base: EngineSnapshot, adjustments: Adjustment[]): AppliedSnapshot {
  const snap: EngineSnapshot = structuredClone(base);
  const demandMultiplier: Record<string, number> = {};
  const notes: string[] = [];
  const mult = (communityId: string, category: string, m: number) => {
    demandMultiplier[key(communityId, category)] = (demandMultiplier[key(communityId, category)] ?? 1) * m;
  };
  const cName = (id: string) => snap.communities.find((c) => c.id === id)?.name ?? id;

  for (const a of adjustments) {
    if (a.kind === "merchant_status") {
      const m = snap.merchants.find((x) => x.id === a.merchantId);
      if (!m) { notes.push(`Merchant ${a.merchantId} was not found; adjustment ignored.`); continue; }
      notes.push(`${m.name} set to ${a.status}.`);
      m.status = a.status;
    } else if (a.kind === "population_increase") {
      const c = snap.communities.find((x) => x.id === a.communityId);
      if (!c || c.populationNeeding <= 0) { notes.push("Community not found for population increase."); continue; }
      const ratio = (c.populationNeeding + a.additionalResidents) / c.populationNeeding;
      c.populationNeeding += a.additionalResidents;
      for (const cat of CATEGORY_IDS) mult(c.id, cat, ratio);
      notes.push(`${cName(c.id)}: +${a.additionalResidents} residents raises expected demand by ${((ratio - 1) * 100).toFixed(1)}%.`);
    } else if (a.kind === "demand_multiplier") {
      const targets = a.communityId ? snap.communities.filter((c) => c.id === a.communityId) : snap.communities;
      for (const c of targets) for (const cat of a.category ? [a.category] : CATEGORY_IDS) mult(c.id, cat, a.multiplier);
      notes.push(`Demand x${a.multiplier} applied${a.communityId ? ` in ${cName(a.communityId)}` : " across all communities"}${a.category ? ` for ${categoryLabel(a.category)}` : ""}.`);
    } else if (a.kind === "inventory_change") {
      const items = snap.inventory.filter((i) => i.communityId === a.communityId && i.category === a.category);
      const total = items.reduce((s, i) => s + i.quantity, 0);
      let target = total;
      if (a.mode === "reduce_percent") target = total * (1 - a.value / 100);
      else if (a.mode === "set_units") target = a.value;
      else target = total + a.value;
      target = Math.max(0, Math.round(target));
      if (items.length === 0) { notes.push(`${cName(a.communityId)} has no ${categoryLabel(a.category)} stock to adjust.`); continue; }
      if (total === 0) { items[0].quantity = target; }
      else for (const i of items) i.quantity = Math.round((i.quantity / total) * target);
      notes.push(`${cName(a.communityId)} ${categoryLabel(a.category)} stock ${total} -> ${target} units.`);
    } else if (a.kind === "shipment_delay") {
      let remaining = a.quantity ?? Infinity;
      const matching = snap.shipments.filter((s) => s.communityId === a.communityId && (!a.category || s.category === a.category)).sort((x, y) => x.etaHours - y.etaHours);
      if (matching.length === 0) { notes.push(`No planned shipment found for ${cName(a.communityId)}${a.category ? ` (${categoryLabel(a.category)})` : ""}; delay has no baseline effect.`); continue; }
      let moved = 0;
      for (const s of matching) {
        if (remaining <= 0) break;
        if (s.quantity <= remaining) { s.etaHours += a.delayHours; remaining -= s.quantity; moved += s.quantity; }
        else {
          // Split: the delayed part keeps arriving later, the rest stays on schedule.
          snap.shipments.push({ ...s, id: `${s.id}~delayed`, quantity: remaining, etaHours: s.etaHours + a.delayHours });
          s.quantity -= remaining; moved += remaining; remaining = 0;
        }
      }
      notes.push(`${moved} units of planned supply to ${cName(a.communityId)} delayed ${a.delayHours}h.`);
      if (a.quantity !== undefined && moved < a.quantity) notes.push(`Only ${moved} of the ${a.quantity} delayed units matched planned shipments.`);
    }
  }
  return { snapshot: snap, demandMultiplier, notes };
}

/* ---------- Analysis ---------- */

export interface CategoryAnalysis {
  category: Category;
  label: string;
  forecast24: number; forecast48: number; forecast72: number;
  inventoryUnits: number; inboundUnits: number;
  unmetUnits: number; coverage: number; stockoutHours: number | null;
  unitPriceCents: number;
}
export interface SupplyGap { category: Category; label: string; shortageUnits: number; shortagePct: number; valueCents: number }

export interface CommunityAnalysis {
  communityId: string; name: string;
  populationNeeding: number; needSeverity: number;
  marketAccess: number;
  /** Effective capacity 0-100 = averageCapacity x merchantCoverageRatio. This is the value used in viability. */
  merchantCapacity: number;
  /** Mean capacity score (0-100) of participating merchants that are not closed. */
  averageCapacity: number;
  /** min(1, operating merchant equivalents / merchants needed), unrounded 0-1. */
  merchantCoverageRatio: number;
  /** Same ratio as a 0-100 score, rounded for display. */
  merchantCoverage: number;
  merchantsNeeded: number; operatingEquivalent: number;
  operatingMerchants: number; participatingMerchants: number;
  inventoryCoverage: number; marketViability: number;
  risk: "low" | "elevated" | "high" | "critical";
  categories: CategoryAnalysis[];
  demand72Units: number; inventoryUnits: number; shortageUnits: number; shortageValueCents: number;
  priorityShare: number; maxEligibleNeedCents: number; cappedAtMaxNeed: boolean;
  recommendedCents: number; voucherPct: number; directPct: number; voucherCents: number; directCents: number;
  action: "vouchers" | "mixed" | "direct_supply"; actionLabel: string;
  topGaps: SupplyGap[];
  problem: string; reasoning: string[]; explanation: string;
  /** Estimated procurement plan reconciled with directCents. Estimates only; nothing is purchased. */
  procurement: ProcurementPlan;
}

export interface AnalysisResult {
  asOf: string;
  programId: string;
  budgetCents: number; committedCents: number; budgetBasisCents: number;
  communities: CommunityAnalysis[];
  totals: { recommendedCents: number; voucherCents: number; directCents: number; unallocatedCents: number };
  forecastEvaluation: { overall: ForecastEvaluation; byCategory: ForecastEvaluation[]; note: string };
  notes: string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const statusFactor = (s: string) => ENGINE.merchantStatusFactor[s] ?? 0;

export function analyze(base: EngineSnapshot, adjustments: Adjustment[] = []): AnalysisResult {
  const { snapshot: snap, demandMultiplier, notes } = applyAdjustments(base, adjustments);
  const budgetBasis = Math.max(0, snap.program.budgetCents - snap.program.committedCents);

  const partial = snap.communities.map((c) => {
    const merchants = snap.merchants.filter((m) => m.communityId === c.id && m.participating);
    const factorOf = new Map(merchants.map((m) => [m.id, statusFactor(m.status)]));
    const active = merchants.filter((m) => statusFactor(m.status) > 0);
    const averageCapacity = active.length ? active.reduce((s, m) => s + m.capacityScore, 0) / active.length : 0;
    const operatingFactor = merchants.reduce((s, m) => s + statusFactor(m.status), 0);
    const coverageRatio = merchantCoverage(operatingFactor, c.merchantsNeeded);
    const capacity = effectiveCapacity(averageCapacity / 100, coverageRatio) * 100;

    const categories: CategoryAnalysis[] = CATEGORIES.map((cat) => {
      const series = snap.history[key(c.id, cat.id)] ?? [];
      const m = demandMultiplier[key(c.id, cat.id)] ?? 1;
      const daily = forecastDailyDemand(series, 3).map((d) => d * m);
      const stock = snap.inventory
        .filter((i) => i.communityId === c.id && i.category === cat.id)
        .reduce((s, i) => s + i.quantity * (factorOf.get(i.merchantId) ?? 0), 0);
      const inbound = snap.shipments.filter((s) => s.communityId === c.id && s.category === cat.id);
      const sim = simulateSupply({ stock, dailyDemand: daily, shipments: inbound.map((s) => ({ quantity: s.quantity, arrivalHours: s.etaHours })) });
      const priced = snap.inventory.filter((i) => i.communityId === c.id && i.category === cat.id && i.quantity > 0);
      const unitPrice = priced.length ? Math.round(priced.reduce((s, i) => s + i.unitPriceCents, 0) / priced.length) : cat.defaultPriceCents;
      return {
        category: cat.id, label: cat.label,
        forecast24: daily[0], forecast48: daily[0] + daily[1], forecast72: daily[0] + daily[1] + daily[2],
        inventoryUnits: stock,
        inboundUnits: inbound.filter((s) => s.etaHours < ENGINE.horizonHours).reduce((s, x) => s + x.quantity, 0),
        unmetUnits: sim.unmet, coverage: sim.coverage, stockoutHours: sim.stockoutHour, unitPriceCents: unitPrice,
      };
    });

    // Weighted inventory coverage across categories that have demand (capped at 1 per category).
    let wSum = 0, wCov = 0;
    for (const ca of categories) {
      if (ca.forecast72 <= 0) continue;
      const w = CATEGORY_BY_ID[ca.category].weight;
      wSum += w; wCov += w * ca.coverage;
    }
    const inventoryCoverage = wSum > 0 ? wCov / wSum : 1;
    const shortageValueCents = Math.round(categories.reduce((s, ca) => s + ca.unmetUnits * ca.unitPriceCents, 0));
    const viability = marketViability(c.marketAccess / 100, capacity / 100, inventoryCoverage);
    return { c, merchants, capacity, averageCapacity, coverageRatio, operatingFactor, coverageScore: coverageRatio * 100, operating: merchants.filter((m) => m.status !== "closed").length, categories, inventoryCoverage, shortageValueCents, viability };
  });

  const shares = priorityShares(partial.map((p) => ({ populationNeeding: p.c.populationNeeding, needSeverity: p.c.needSeverity, deficitValueCents: p.shortageValueCents })));
  const caps = partial.map((p) => maxEligibleNeedCents(p.c.populationNeeding, p.c.needSeverity, p.shortageValueCents));
  const dist = distributeBudget(budgetBasis, shares, caps);

  const communities: CommunityAnalysis[] = partial.map((p, i) => {
    const vShare = voucherShare(p.viability);
    const rec = dist.allocations[i];
    const [voucherCents, directCents] = (() => {
      const v = Math.round(rec * vShare);
      return [v, rec - v];
    })();
    const allGaps: SupplyGap[] = p.categories
      .filter((ca) => ca.unmetUnits > 0.5)
      .map((ca) => ({ category: ca.category, label: ca.label, shortageUnits: Math.ceil(ca.unmetUnits), shortagePct: ca.forecast72 > 0 ? ca.unmetUnits / ca.forecast72 : 0, valueCents: Math.round(ca.unmetUnits * ca.unitPriceCents) }))
      .sort((a, b) => b.shortagePct * CATEGORY_BY_ID[b.category].weight - a.shortagePct * CATEGORY_BY_ID[a.category].weight);
    const gaps = allGaps.slice(0, 3);
    const unitCost = new Map(p.categories.map((ca) => [ca.category, ca.unitPriceCents]));
    const procurement = planProcurement(directCents, allGaps.map((g) => ({
      category: g.category, label: g.label, shortageUnits: g.shortageUnits, unitCostCents: unitCost.get(g.category) ?? 0,
      priority: g.shortagePct * CATEGORY_BY_ID[g.category].weight,
    })));
    const action = actionFor(vShare);
    const demand72 = p.categories.reduce((s, ca) => s + ca.forecast72, 0);
    const inv = p.categories.reduce((s, ca) => s + ca.inventoryUnits, 0);
    const shortage = p.categories.reduce((s, ca) => s + ca.unmetUnits, 0);
    const risk = riskStatus(p.viability, p.inventoryCoverage);
    const capacityNote = `${p.operating} of ${p.merchants.length} participating merchants operating`;
    const problem =
      action === "direct_supply"
        ? `Local market cannot reliably serve residents: ${gaps[0] ? `${gaps[0].label.toLowerCase()} falls ${pct(gaps[0].shortagePct)} short over 72h` : "inventory is thin"}.`
        : action === "mixed"
          ? `Market is partly functional: ${gaps[0] ? `${gaps[0].label.toLowerCase()} runs ${pct(gaps[0].shortagePct)} short over 72h` : "capacity is uneven"}.`
          : "Local market is able to serve demand; vouchers will be redeemable for essential goods.";
    const reasoning = [
      `Market viability ${p.viability.toFixed(2)} = ${ENGINE.viabilityWeights.marketAccess} x access ${(p.c.marketAccess / 100).toFixed(2)} + ${ENGINE.viabilityWeights.merchantCapacity} x effective capacity ${(p.capacity / 100).toFixed(2)} + ${ENGINE.viabilityWeights.inventoryCoverage} x inventory coverage ${p.inventoryCoverage.toFixed(2)}.`,
      `Effective capacity ${(p.capacity / 100).toFixed(2)} = average capacity ${(p.averageCapacity / 100).toFixed(2)} x merchant coverage ${p.coverageRatio.toFixed(2)} (${p.operatingFactor.toFixed(1)} operating merchant equivalents / ${p.c.merchantsNeeded} needed, capped at 1).`,
      `Voucher share ${pct(vShare)} = clamp(0.10 + 0.75 x ${p.viability.toFixed(2)}, 0.10, 0.85); the remaining ${pct(1 - vShare)} goes to direct supply.`,
      `${capacityNote}.`,
      `Priority share ${pct(shares[i])} from population (${p.c.populationNeeding.toLocaleString("en-US")} people), severity ${p.c.needSeverity}/100 and projected shortage value.`,
    ];
    if (dist.capped.includes(i)) reasoning.push("Recommended budget is held at this community's maximum eligible need; the remainder was redistributed to other communities.");
    return {
      communityId: p.c.id, name: p.c.name,
      populationNeeding: p.c.populationNeeding, needSeverity: p.c.needSeverity,
      marketAccess: p.c.marketAccess, merchantCapacity: Math.round(p.capacity * 10) / 10, averageCapacity: Math.round(p.averageCapacity * 10) / 10,
      merchantCoverageRatio: p.coverageRatio, merchantCoverage: Math.round(p.coverageScore), merchantsNeeded: p.c.merchantsNeeded, operatingEquivalent: p.operatingFactor,
      operatingMerchants: p.operating, participatingMerchants: p.merchants.length,
      inventoryCoverage: p.inventoryCoverage, marketViability: p.viability, risk, categories: p.categories,
      demand72Units: demand72, inventoryUnits: inv, shortageUnits: shortage, shortageValueCents: p.shortageValueCents,
      priorityShare: shares[i], maxEligibleNeedCents: caps[i], cappedAtMaxNeed: dist.capped.includes(i),
      recommendedCents: rec, voucherPct: rec > 0 ? voucherCents / rec : vShare, directPct: rec > 0 ? directCents / rec : 1 - vShare,
      voucherCents, directCents, action, actionLabel: ACTION_LABEL[action], topGaps: gaps, problem, reasoning,
      explanation: `${p.c.name}: viability ${p.viability.toFixed(2)} -> ${pct(vShare)} vouchers / ${pct(1 - vShare)} direct supply.`,
      procurement,
    };
  });

  // Forecast quality: rolling-origin holdout on the same synthetic history, with a moving-average baseline.
  const errs: ForecastErrors[] = [];
  const byCat: Record<string, ForecastErrors[]> = {};
  for (const c of snap.communities) {
    for (const cat of CATEGORY_IDS) {
      const series = base.history[key(c.id, cat)] ?? [];
      if (series.length <= ENGINE.forecast.minTrainDays) continue;
      const e = rollingHoldout(series, 3);
      errs.push(e);
      (byCat[cat] ??= []).push(e);
    }
  }
  const overall = evaluate("All categories", mergeErrors(errs));
  const byCategory = CATEGORY_IDS.filter((c) => byCat[c]).map((c) => evaluate(categoryLabel(c), mergeErrors(byCat[c])));

  const totals = {
    recommendedCents: communities.reduce((s, c) => s + c.recommendedCents, 0),
    voucherCents: communities.reduce((s, c) => s + c.voucherCents, 0),
    directCents: communities.reduce((s, c) => s + c.directCents, 0),
    unallocatedCents: dist.unallocatedCents,
  };
  return {
    asOf: snap.asOf, programId: snap.program.id, budgetCents: snap.program.budgetCents, committedCents: snap.program.committedCents, budgetBasisCents: budgetBasis,
    communities, totals,
    forecastEvaluation: {
      overall, byCategory,
      note: "Synthetic-data model evaluation: rolling-origin holdout over the seeded 30-day history (1-3 day horizons). Results describe this synthetic dataset only and are not a claim of real-world accuracy.",
    },
    notes,
  };
}

/* ---------- Scenario comparison ---------- */

export interface Driver { factor: string; before: number; after: number; delta: number; viabilityContribution: number }
export interface CommunityDelta {
  communityId: string; name: string;
  before: { viability: number; voucherPct: number; recommendedCents: number; voucherCents: number; directCents: number; shortageUnits: number; inventoryCoverage: number; risk: string };
  after: { viability: number; voucherPct: number; recommendedCents: number; voucherCents: number; directCents: number; shortageUnits: number; inventoryCoverage: number; risk: string };
  drivers: Driver[];
  summary: string;
}

export function compareAnalyses(before: AnalysisResult, after: AnalysisResult): CommunityDelta[] {
  const w = ENGINE.viabilityWeights;
  return before.communities.map((b) => {
    const a = after.communities.find((x) => x.communityId === b.communityId) ?? b;
    const snap = (c: CommunityAnalysis) => ({ viability: c.marketViability, voucherPct: c.voucherPct, recommendedCents: c.recommendedCents, voucherCents: c.voucherCents, directCents: c.directCents, shortageUnits: c.shortageUnits, inventoryCoverage: c.inventoryCoverage, risk: c.risk });
    const drivers: Driver[] = [
      { factor: "Market access", before: b.marketAccess / 100, after: a.marketAccess / 100, w: w.marketAccess },
      { factor: "Merchant capacity", before: b.merchantCapacity / 100, after: a.merchantCapacity / 100, w: w.merchantCapacity },
      { factor: "Inventory coverage", before: b.inventoryCoverage, after: a.inventoryCoverage, w: w.inventoryCoverage },
    ].map((d) => ({ factor: d.factor, before: d.before, after: d.after, delta: d.after - d.before, viabilityContribution: d.w * (d.after - d.before) }))
     .filter((d) => Math.abs(d.viabilityContribution) > 0.0005)
     .sort((x, y) => Math.abs(y.viabilityContribution) - Math.abs(x.viabilityContribution));
    const dv = a.marketViability - b.marketViability;
    const summary = drivers.length === 0 && a.recommendedCents === b.recommendedCents
      ? "No change from this scenario."
      : `Viability ${b.marketViability.toFixed(2)} -> ${a.marketViability.toFixed(2)} (${dv >= 0 ? "+" : ""}${dv.toFixed(2)})${drivers[0] ? `, driven mainly by ${drivers[0].factor.toLowerCase()}` : ""}; voucher share ${pct(b.voucherPct)} -> ${pct(a.voucherPct)}.`;
    return { communityId: b.communityId, name: b.name, before: snap(b), after: snap(a), drivers, summary };
  });
}

/** Distribute `total` across weights; exported for convenience in the UI/report code. */
export { splitCents };
