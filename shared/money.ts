/** All money in RELAY is integer cents. These helpers never use floats for stored values. */
export function assertCents(value: unknown, label = "amount"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents`);
  }
  return value;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function formatCents(cents: number, opts: { compact?: boolean } = {}): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  if (opts.compact && abs >= 100_000) {
    const d = abs / 100;
    if (d >= 1_000_000) return `${sign}$${(d / 1_000_000).toFixed(2)}M`;
    return `${sign}$${(d / 1000).toFixed(d >= 100_000 ? 0 : 1)}k`;
  }
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${rem}`;
}

/** Split `total` cents proportionally to `weights` using the largest-remainder method.
 * Guarantees: integer parts, sum(parts) === total, no negatives. */
export function splitCents(total: number, weights: number[]): number[] {
  assertCents(total);
  if (total < 0) throw new Error("total must be >= 0");
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    const out = weights.map(() => base);
    let rest = total - base * weights.length;
    for (let i = 0; rest > 0; i = (i + 1) % out.length, rest--) out[i]++;
    return out;
  }
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) floors[order[k].i]++;
  return floors;
}
