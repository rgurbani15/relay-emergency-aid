import { ENGINE } from "./constants";
import { splitCents } from "./money";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Merchant coverage = min(1, operating merchant equivalents / merchants needed).
 * Operating equivalents count open = 1, limited = 0.5, closed = 0 (ENGINE.merchantStatusFactor).
 */
export function merchantCoverage(operatingEquivalent: number, merchantsNeeded: number): number {
  return clamp(operatingEquivalent / Math.max(1, merchantsNeeded), 0, 1);
}

/** effectiveCapacity = averageCapacity x merchantCoverage (both 0..1). A strong but thin merchant network is not a strong market. */
export function effectiveCapacity(averageCapacity01: number, coverage01: number): number {
  return clamp(averageCapacity01, 0, 1) * clamp(coverage01, 0, 1);
}

/** marketViability = 0.35*access + 0.25*effectiveCapacity + 0.40*inventoryCoverage (all in 0..1). */
export function marketViability(access01: number, capacity01: number, coverage01: number): number {
  const w = ENGINE.viabilityWeights;
  return (
    w.marketAccess * clamp(access01, 0, 1) +
    w.merchantCapacity * clamp(capacity01, 0, 1) +
    w.inventoryCoverage * clamp(coverage01, 0, 1)
  );
}

/** voucherShare = clamp(0.10 + 0.75 * viability, 0.10, 0.85) */
export function voucherShare(viability: number): number {
  const v = ENGINE.voucherShare;
  return clamp(v.base + v.slope * viability, v.min, v.max);
}

export interface PriorityInput {
  populationNeeding: number;
  needSeverity: number; // 0..100
  deficitValueCents: number;
}

/** Regional priority share (sums to 1): 0.40*popShare + 0.35*severityShare + 0.25*deficitShare.
 * A component whose total is zero falls back to an equal split so shares always sum to 1. */
export function priorityShares(items: PriorityInput[]): number[] {
  const n = items.length;
  if (n === 0) return [];
  const share = (vals: number[]) => {
    const total = vals.reduce((a, b) => a + b, 0);
    return total > 0 ? vals.map((v) => v / total) : vals.map(() => 1 / n);
  };
  const pop = share(items.map((i) => Math.max(0, i.populationNeeding)));
  const sev = share(items.map((i) => Math.max(0, i.needSeverity)));
  const def = share(items.map((i) => Math.max(0, i.deficitValueCents)));
  const w = ENGINE.priorityWeights;
  return items.map((_, i) => w.population * pop[i] + w.severity * sev[i] + w.deficit * def[i]);
}

/** maximum eligible need (cents): people x base x (0.5 + severity) + projected shortage value */
export function maxEligibleNeedCents(populationNeeding: number, needSeverity: number, shortageValueCents: number): number {
  return Math.round(populationNeeding * ENGINE.perPersonBaseCents * (0.5 + clamp(needSeverity, 0, 100) / 100)) + Math.max(0, Math.round(shortageValueCents));
}

export interface DistributionResult {
  allocations: number[];
  unallocatedCents: number;
  /** Indices of communities held at their eligible-need cap. */
  capped: number[];
}

/** Distribute `budgetCents` proportionally to `shares`, never exceeding per-community caps.
 * Whenever a community hits its cap, the excess is redistributed among the remaining eligible
 * communities (water-filling). Integer cents via largest remainder; sum(allocations) <= budget. */
export function distributeBudget(budgetCents: number, shares: number[], capsCents: number[]): DistributionResult {
  const n = shares.length;
  const alloc = new Array<number>(n).fill(0);
  const caps = capsCents.map((c) => Math.max(0, Math.floor(c)));
  let remaining = Math.max(0, Math.floor(budgetCents));
  const active = new Set<number>(caps.map((c, i) => (c > 0 && shares[i] > 0 ? i : -1)).filter((i) => i >= 0));
  // Communities with zero share but positive cap are only eligible if nobody else is.
  if (active.size === 0) {
    caps.forEach((c, i) => c > 0 && active.add(i));
  }
  const capped: number[] = [];
  for (let guard = 0; guard < n + 1 && remaining > 0 && active.size > 0; guard++) {
    const idx = [...active];
    const parts = splitCents(remaining, idx.map((i) => (shares[i] > 0 ? shares[i] : 1)));
    let hit = false;
    idx.forEach((i, k) => {
      const room = caps[i] - alloc[i];
      if (parts[k] >= room) {
        hit = true;
      }
    });
    if (!hit) {
      idx.forEach((i, k) => (alloc[i] += parts[k]));
      remaining = 0;
      break;
    }
    // Fill every capped community to its cap, remove it, and redistribute the rest next pass.
    idx.forEach((i, k) => {
      const room = caps[i] - alloc[i];
      if (parts[k] >= room) {
        alloc[i] += room;
        remaining -= room;
        active.delete(i);
        capped.push(i);
      }
    });
  }
  return { allocations: alloc, unallocatedCents: Math.max(0, remaining), capped };
}

export function actionFor(voucherPct: number): "vouchers" | "mixed" | "direct_supply" {
  if (voucherPct >= 0.6) return "vouchers";
  if (voucherPct <= 0.35) return "direct_supply";
  return "mixed";
}

export const ACTION_LABEL = {
  vouchers: "Favor voucher-based assistance",
  mixed: "Use a mix of vouchers and direct supply distribution",
  direct_supply: "Favor direct essential-supply distribution",
} as const;

export function riskStatus(viability: number, inventoryCoverage: number): "low" | "elevated" | "high" | "critical" {
  let level = viability >= 0.7 ? 0 : viability >= 0.5 ? 1 : viability >= 0.3 ? 2 : 3;
  if (inventoryCoverage < 0.35) level = Math.max(level, 3);
  else if (inventoryCoverage < 0.6) level = Math.max(level, 2);
  return (["low", "elevated", "high", "critical"] as const)[level];
}


/* ---------- Direct-supply procurement plan (an ESTIMATE; nothing is purchased) ---------- */

export interface ProcurementNeed {
  category: string; label: string;
  shortageUnits: number; unitCostCents: number;
  /** Higher = funded first. */
  priority: number;
}
export interface ProcurementLine {
  category: string; label: string;
  shortageUnits: number; unitCostCents: number;
  units: number; costCents: number;
  shortageValueCents: number; unfundedUnits: number; fundedPct: number;
}
export interface ProcurementPlan {
  budgetCents: number; allocatedCents: number; unallocatedCents: number;
  shortageValueCents: number; unfundedShortageCents: number;
  lines: ProcurementLine[];
  estimate: true;
}

/**
 * Reconciles the direct-supply budget with projected shortages. Shortages are funded in priority order
 * (category criticality x share of 72h demand left unmet), in whole units, never above the projected shortage
 * and never above the budget. Money that cannot be placed (budget exceeds shortages, or less than one unit is left)
 * is reported as unallocated. allocated + unallocated always equals the budget exactly.
 */
export function planProcurement(budgetCents: number, needs: ProcurementNeed[]): ProcurementPlan {
  const budget = Math.max(0, Math.round(budgetCents));
  let left = budget;
  const eligible = needs
    .filter((n) => n.shortageUnits > 0 && n.unitCostCents > 0)
    .sort((a, b) => b.priority - a.priority);
  const lines: ProcurementLine[] = eligible.map((n) => {
    const shortage = Math.ceil(n.shortageUnits);
    const units = Math.max(0, Math.min(shortage, Math.floor(left / n.unitCostCents)));
    const cost = units * n.unitCostCents;
    left -= cost;
    return {
      category: n.category, label: n.label, shortageUnits: shortage, unitCostCents: n.unitCostCents,
      units, costCents: cost, shortageValueCents: shortage * n.unitCostCents,
      unfundedUnits: shortage - units, fundedPct: shortage > 0 ? units / shortage : 0,
    };
  });
  const allocated = budget - left;
  const shortageValue = lines.reduce((s, l) => s + l.shortageValueCents, 0);
  return { budgetCents: budget, allocatedCents: allocated, unallocatedCents: left, shortageValueCents: shortageValue, unfundedShortageCents: shortageValue - allocated, lines, estimate: true };
}
