import { ENGINE } from "./constants";

/** Demand forecasting: simple, explainable, and tested against a moving-average baseline. */

export function simpleMovingAverage(series: number[], window = ENGINE.forecast.baselineWindow): number {
  if (series.length === 0) return 0;
  const slice = series.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Linearly weighted moving average (most recent day weighs most). */
export function weightedMovingAverage(series: number[], window = 7): number {
  const slice = series.slice(-window);
  if (slice.length === 0) return 0;
  let num = 0;
  let den = 0;
  slice.forEach((v, i) => {
    num += v * (i + 1);
    den += i + 1;
  });
  return num / den;
}

export interface HoltState {
  level: number;
  trend: number;
}

/** Damped-trend exponential smoothing (Holt). Level & trend are smoothed; trend is damped by phi
 * so forecasts do not extrapolate a short-term slope indefinitely. */
export function fitDampedHolt(series: number[], p = ENGINE.forecast): HoltState {
  if (series.length === 0) return { level: 0, trend: 0 };
  if (series.length < 4) return { level: series[series.length - 1], trend: 0 };
  const first = weightedMovingAverage(series.slice(0, 3), 3);
  const second = weightedMovingAverage(series.slice(3, 6), 3);
  let level = first;
  let trend = (second - first) / 3;
  for (let i = 0; i < series.length; i++) {
    const y = series[i];
    const prevLevel = level;
    level = p.alpha * y + (1 - p.alpha) * (prevLevel + p.phi * trend);
    trend = p.beta * (level - prevLevel) + (1 - p.beta) * p.phi * trend;
  }
  return { level, trend };
}

/** Forecast of daily demand for each of the next `horizonDays` days. Never negative. */
export function forecastDailyDemand(series: number[], horizonDays = 3, p = ENGINE.forecast): number[] {
  const { level, trend } = fitDampedHolt(series, p);
  const out: number[] = [];
  let dampSum = 0;
  let phiPow = 1;
  for (let h = 1; h <= horizonDays; h++) {
    phiPow *= p.phi;
    dampSum += phiPow;
    out.push(Math.max(0, level + dampSum * trend));
  }
  return out;
}

export function baselineForecast(series: number[], horizonDays = 3): number[] {
  const v = Math.max(0, simpleMovingAverage(series));
  return Array.from({ length: horizonDays }, () => v);
}

export interface ForecastErrors {
  selectedAbs: number[];
  baselineAbs: number[];
  /** Percentage errors for observations where actual > 0 (zero-demand days are excluded, not divided by). */
  selectedPct: number[];
  baselinePct: number[];
  zeroActuals: number;
}

/** Rolling-origin holdout. For each origin t >= minTrain, fit on series[0..t-1] and compare the
 * 1..horizon-day forecasts with what actually happened. Fully deterministic. */
export function rollingHoldout(series: number[], horizonDays = 3, minTrain = ENGINE.forecast.minTrainDays): ForecastErrors {
  const out: ForecastErrors = { selectedAbs: [], baselineAbs: [], selectedPct: [], baselinePct: [], zeroActuals: 0 };
  for (let t = minTrain; t < series.length; t++) {
    const train = series.slice(0, t);
    const sel = forecastDailyDemand(train, horizonDays);
    const base = baselineForecast(train, horizonDays);
    for (let h = 0; h < horizonDays && t + h < series.length; h++) {
      const actual = series[t + h];
      out.selectedAbs.push(Math.abs(sel[h] - actual));
      out.baselineAbs.push(Math.abs(base[h] - actual));
      if (actual > 0) {
        out.selectedPct.push(Math.abs(sel[h] - actual) / actual);
        out.baselinePct.push(Math.abs(base[h] - actual) / actual);
      } else out.zeroActuals++;
    }
  }
  return out;
}

export interface ErrorSummary {
  samples: number;
  mae: number;
  /** Mean absolute percentage error as a fraction (0.12 = 12%); null when no non-zero actuals. */
  mape: number | null;
  mapeSamples: number;
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function summarizeErrors(abs: number[], pct: number[]): ErrorSummary {
  return { samples: abs.length, mae: mean(abs), mape: pct.length ? mean(pct) : null, mapeSamples: pct.length };
}

export function mergeErrors(list: ForecastErrors[]): ForecastErrors {
  return list.reduce<ForecastErrors>(
    (acc, e) => ({
      selectedAbs: acc.selectedAbs.concat(e.selectedAbs),
      baselineAbs: acc.baselineAbs.concat(e.baselineAbs),
      selectedPct: acc.selectedPct.concat(e.selectedPct),
      baselinePct: acc.baselinePct.concat(e.baselinePct),
      zeroActuals: acc.zeroActuals + e.zeroActuals,
    }),
    { selectedAbs: [], baselineAbs: [], selectedPct: [], baselinePct: [], zeroActuals: 0 },
  );
}

export interface ForecastEvaluation {
  label: string;
  selected: ErrorSummary;
  baseline: ErrorSummary;
  /** True when the selected model has lower MAE than the baseline. */
  selectedBeatsBaseline: boolean;
}

export function evaluate(label: string, e: ForecastErrors): ForecastEvaluation {
  const selected = summarizeErrors(e.selectedAbs, e.selectedPct);
  const baseline = summarizeErrors(e.baselineAbs, e.baselinePct);
  return { label, selected, baseline, selectedBeatsBaseline: selected.mae < baseline.mae };
}

/** Time-phased supply simulation across the horizon. Hour-by-hour: stock rises when shipments land,
 * falls with demand, and any demand that cannot be served is counted as unmet. */
export function simulateSupply(opts: {
  stock: number;
  /** Forecast demand units for each day of the horizon (length 3 for 72h). */
  dailyDemand: number[];
  /** Shipments with arrival measured in hours from now. Arrival <= 0 means already on hand. */
  shipments: { quantity: number; arrivalHours: number }[];
  horizonHours?: number;
}) {
  const horizon = opts.horizonHours ?? ENGINE.horizonHours;
  let stock = Math.max(0, opts.stock);
  let demand = 0;
  let unmet = 0;
  let stockoutHour: number | null = null;
  const pending = opts.shipments.map((s) => ({ ...s, applied: false }));
  for (let h = 0; h < horizon; h++) {
    for (const s of pending) {
      if (!s.applied && s.arrivalHours <= h) {
        stock += s.quantity;
        s.applied = true;
      }
    }
    const rate = (opts.dailyDemand[Math.min(Math.floor(h / 24), opts.dailyDemand.length - 1)] ?? 0) / 24;
    const served = Math.min(stock, rate);
    stock -= served;
    demand += rate;
    if (rate - served > 1e-9) {
      unmet += rate - served;
      if (stockoutHour === null) stockoutHour = h;
    }
  }
  return { demand, unmet, coverage: demand > 0 ? Math.min(1, Math.max(0, 1 - unmet / demand)) : 1, stockoutHour };
}

/**
 * Where to draw the "Projected stockout" marker on a forecast chart, in days from now.
 * Returns null unless the supply simulation actually produced a stockout hour inside the displayed horizon,
 * so the chart never shows an invented or out-of-window marker.
 */
export function stockoutMarker(stockoutHours: number | null | undefined, horizonDays: number): { days: number; now: boolean } | null {
  if (stockoutHours === null || stockoutHours === undefined || !Number.isFinite(stockoutHours) || stockoutHours < 0) return null;
  if (horizonDays <= 0 || stockoutHours / 24 > horizonDays) return null;
  return { days: stockoutHours / 24, now: stockoutHours < 1 };
}
