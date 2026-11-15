import { describe, expect, it } from "vitest";
import { baselineForecast, evaluate, forecastDailyDemand, rollingHoldout, simulateSupply, summarizeErrors, weightedMovingAverage } from "../shared/forecast";
import { buildSeed } from "../scripts/seed-data";
import { analyze } from "../shared/engine";

const seed = buildSeed("2026-11-12T16:00:00.000Z");

describe("forecasting", () => {
  it("uses the stored history: a rising series forecasts above a falling one", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i * 5);
    const down = Array.from({ length: 30 }, (_, i) => 300 - i * 5);
    expect(forecastDailyDemand(up)[0]).toBeGreaterThan(forecastDailyDemand(down)[0]);
    expect(forecastDailyDemand(up)[0]).toBeGreaterThan(up[up.length - 1] * 0.95);
  });

  it("never forecasts negative demand, even for steeply falling or empty series", () => {
    const crash = Array.from({ length: 30 }, (_, i) => Math.max(0, 100 - i * 20));
    expect(forecastDailyDemand(crash, 3).every((v) => v >= 0)).toBe(true);
    expect(forecastDailyDemand([], 3)).toEqual([0, 0, 0]);
    expect(baselineForecast([0, 0, 0], 3).every((v) => v >= 0)).toBe(true);
  });

  it("the weighted moving average favours recent days", () => {
    expect(weightedMovingAverage([10, 10, 10, 50])).toBeGreaterThan(20);
  });

  it("holdout evaluation is reproducible", () => {
    const s = seed.snapshot.history["com_cedar_grove|drinking_water"];
    expect(JSON.stringify(rollingHoldout(s))).toBe(JSON.stringify(rollingHoldout(s)));
    expect(JSON.stringify(analyze(seed.snapshot).forecastEvaluation)).toBe(JSON.stringify(analyze(seed.snapshot).forecastEvaluation));
  });

  it("baseline comparison is honest: a perfectly flat series is not beaten by the trend model, and a trending series is", () => {
    const flat = rollingHoldout(Array.from({ length: 30 }, () => 100));
    const flatEval = evaluate("flat", flat);
    expect(flatEval.baseline.mae).toBeCloseTo(0, 8);
    expect(flatEval.selectedBeatsBaseline).toBe(false);
    const trend = evaluate("trend", rollingHoldout(Array.from({ length: 30 }, (_, i) => 100 + i * 8)));
    expect(trend.selectedBeatsBaseline).toBe(true);
  });

  it("MAPE handles zero demand without dividing by zero", () => {
    const series = [...Array.from({ length: 20 }, () => 0), 5, 0, 7, 0, 3, 0, 4, 0, 6, 0];
    const e = rollingHoldout(series);
    expect(e.zeroActuals).toBeGreaterThan(0);
    const s = summarizeErrors(e.selectedAbs, e.selectedPct);
    expect(Number.isFinite(s.mae)).toBe(true);
    expect(s.mape === null || Number.isFinite(s.mape)).toBe(true);
    expect(summarizeErrors([0, 0], []).mape).toBeNull();
  });

  it("reports per-category errors from the seeded history", () => {
    const r = analyze(seed.snapshot);
    expect(r.forecastEvaluation.byCategory).toHaveLength(7);
    expect(r.forecastEvaluation.overall.selected.samples).toBeGreaterThan(100);
    expect(r.forecastEvaluation.note).toMatch(/synthetic/i);
  });

  it("supply simulation: shipments help only if they arrive before stock runs out", () => {
    const early = simulateSupply({ stock: 100, dailyDemand: [240, 240, 240], shipments: [{ quantity: 600, arrivalHours: 6 }] });
    const late = simulateSupply({ stock: 100, dailyDemand: [240, 240, 240], shipments: [{ quantity: 600, arrivalHours: 40 }] });
    expect(early.unmet).toBeLessThan(late.unmet);
    expect(simulateSupply({ stock: 720, dailyDemand: [240, 240, 240], shipments: [] }).coverage).toBeCloseTo(1, 6);
  });
});
