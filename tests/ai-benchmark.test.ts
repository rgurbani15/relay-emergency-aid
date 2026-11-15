import { describe, expect, it, vi } from "vitest";
import { setup } from "./helpers/app";
import { BENCHMARK_DATASET, FIELDS, computeMetrics, runBenchmark, scoreProposal, type BenchmarkReport } from "../worker/services/aiBenchmark";
import { aiProposalSchema } from "../worker/services/ai";

/**
 * These tests verify the SCORING LOGIC using scripted mock models (an oracle, a hallucinator, a broken one).
 * They say nothing about how well the real Workers AI model performs; that is only ever measured by running the
 * benchmark against the real binding, and those measurements are stored and displayed from the database.
 */

const ctx = {
  communities: [{ id: "com_cedar_grove", name: "Cedar Grove" }, { id: "com_east_valley", name: "East Valley" }, { id: "com_north_ridge", name: "North Ridge" }],
  merchants: [
    { id: "MER-1001", name: "Ridgeline Market", communityId: "com_north_ridge" }, { id: "MER-1003", name: "Summit Hardware & Supply", communityId: "com_north_ridge" },
    { id: "MER-1004", name: "Cedar Grove Grocers", communityId: "com_cedar_grove" }, { id: "MER-1005", name: "Grove Family Pharmacy", communityId: "com_cedar_grove" },
    { id: "MER-1006", name: "Pinecone Provisions", communityId: "com_cedar_grove" }, { id: "MER-1007", name: "Valley Corner Store", communityId: "com_east_valley" },
    { id: "MER-1008", name: "East Valley Supply Depot", communityId: "com_east_valley" },
  ],
};

const proposalFor = (r: BenchmarkReport) => {
  const e = r.expected;
  const f = (value: unknown, key: string) => (value === null ? null : { [key]: value, sourcePhrase: null, confidence: "high" });
  return { community: f(e.community, "name"), category: f(e.category, "value"), delayedSupply: f(e.delayedQuantity, "quantity"), delayHours: f(e.delayHours, "value"), additionalResidents: f(e.additionalResidents, "value"), merchantClosure: f(e.merchantClosure, "merchantName"), missingInformation: [], assumptions: [] };
};
const reportFromPrompt = (messages: { content: string }[]) => {
  const text = messages[1].content.split('"""')[1];
  return BENCHMARK_DATASET.find((r) => r.text === text)!;
};
const envWith = (run: (model: string, input: { messages: { content: string }[] }) => Promise<unknown>) => ({ AI: { run }, AI_MODEL: "@cf/test/model" }) as never;

describe("AI benchmark dataset", () => {
  it("has at least 25 synthetic reports with unique ids and expected fields, covering every required scenario type", () => {
    expect(BENCHMARK_DATASET.length).toBeGreaterThanOrEqual(25);
    expect(new Set(BENCHMARK_DATASET.map((r) => r.id)).size).toBe(BENCHMARK_DATASET.length);
    const tags = new Set(BENCHMARK_DATASET.map((r) => r.tag));
    for (const t of ["delayed shipment", "merchant closure", "population increase", "inventory reduction", "multiple communities", "missing information", "ambiguous quantity", "unrelated numbers"]) expect(tags.has(t), t).toBe(true);
    for (const r of BENCHMARK_DATASET) { expect(Object.keys(r.expected).sort()).toEqual([...FIELDS].sort()); expect(r.text.length).toBeGreaterThanOrEqual(10); }
  });
});

describe("AI benchmark scoring (scripted mock models, not real model performance)", () => {
  it("scores a perfect oracle at 100% accuracy with no unsupported or missing values", async () => {
    const out = await runBenchmark(envWith(async (_m, i) => ({ response: JSON.stringify(proposalFor(reportFromPrompt(i.messages))) })), ctx);
    expect(out.metrics.evaluated).toBe(BENCHMARK_DATASET.length);
    expect(out.metrics.fieldAccuracy).toBe(1);
    expect(out.metrics.unsupportedValueRate).toBe(0);
    expect(out.metrics.missingFieldRate).toBe(0);
    expect(out.metrics.invalidJsonRate).toBe(0);
  });

  it("counts invalid JSON, schema-invalid output and call errors separately", async () => {
    let n = 0;
    const out = await runBenchmark(envWith(async (_m, i) => {
      n++;
      if (n === 2) return "definitely not json";
      if (n === 3) return { response: JSON.stringify({ delayHours: "soon" }) };
      if (n === 4) throw new Error("model overloaded");
      return { response: JSON.stringify(proposalFor(reportFromPrompt(i.messages))) };
    }), ctx);
    expect(out.metrics.invalidJsonCount).toBe(1);
    expect(out.metrics.schemaInvalidCount).toBe(1);
    expect(out.metrics.errored).toBe(1);
    expect(out.metrics.evaluated).toBe(BENCHMARK_DATASET.length - 1);
    expect(out.metrics.invalidJsonRate).toBeCloseTo(1 / (BENCHMARK_DATASET.length - 1), 10);
  });

  it("flags invented values as unsupported and counts omissions as missing", () => {
    const r = BENCHMARK_DATASET.find((x) => x.id === "R01")!;
    const halluc = aiProposalSchema.parse({ community: { name: "Atlantis", confidence: "high" }, delayedSupply: { quantity: 900, confidence: "high" }, delayHours: { value: 24, confidence: "high" }, category: null });
    const s = scoreProposal(r, halluc, ctx);
    expect(s.unsupported.sort()).toEqual(["community", "delayedQuantity"]);
    expect(s.missing).toEqual(["category"]);
    expect(s.fieldCorrect!.delayHours).toBe(true);
    expect(s.fieldCorrect!.community).toBe(false);
    const m = computeMetrics([{ ...r, outcome: "ok", latencyMs: 10, ...s }]);
    expect(m.unsupportedValueRate).toBeCloseTo(2 / 3, 10);
    expect(m.fieldAccuracy).toBeLessThan(1);
  });

  it("an always-null model is never unsupported but misses every expected value", async () => {
    const empty = { community: null, category: null, delayedSupply: null, delayHours: null, additionalResidents: null, merchantClosure: null, missingInformation: [], assumptions: [] };
    const out = await runBenchmark(envWith(async () => ({ response: JSON.stringify(empty) })), ctx);
    expect(out.metrics.unsupportedValueRate).toBe(0);
    expect(out.metrics.missingFieldRate).toBe(1);
    // Many expected values are null, so an always-null model still scores some correct fields; accuracy must stay well below 1.
    expect(out.metrics.fieldAccuracy).toBeLessThan(0.7);
  });

  it("measures latency per report from the injected clock", async () => {
    let t = 0;
    const out = await runBenchmark(envWith(async (_m, i) => { t += 50; return { response: JSON.stringify(proposalFor(reportFromPrompt(i.messages))) }; }), ctx, BENCHMARK_DATASET.slice(0, 4), () => t);
    expect(out.results.every((x) => x.latencyMs === 50)).toBe(true);
    expect(out.metrics.latencyMs.mean).toBe(50);
  });

  it("throws ai_unavailable when no binding is configured instead of inventing results", async () => {
    await expect(runBenchmark({} as never, ctx)).rejects.toMatchObject({ code: "ai_unavailable" });
  });
});

describe("AI benchmark endpoints", () => {
  it("without Workers AI: run returns 503, stores nothing, and the page reports no measured results", async () => {
    const t = setup(); const cookie = await t.login("coordinator");
    const run = await t.call("POST", "/api/intelligence/ai-eval/run", { cookie, body: { programId: "prog_pine_valley" } });
    expect(run.status).toBe(503);
    const get = await t.call("GET", "/api/intelligence/ai-eval?programId=prog_pine_valley", { cookie });
    expect(get.json.aiAvailable).toBe(false);
    expect(get.json.latest).toBeNull();
    expect(get.json.dataset.synthetic).toBe(true);
    expect(t.db.raw.prepare("SELECT COUNT(*) n FROM ai_eval_runs").get()).toEqual({ n: 0 });
  });

  it("with a mock binding: stores the measured run, audits it, and never touches financial records", async () => {
    const run = vi.fn(async (_m: string, i: { messages: { content: string }[] }) => ({ response: JSON.stringify(proposalFor(reportFromPrompt(i.messages))) }));
    const t = setup({ ai: { run } }); const cookie = await t.login("coordinator");
    const fin = () => JSON.stringify([t.db.raw.prepare("SELECT * FROM vouchers ORDER BY id").all(), t.db.raw.prepare("SELECT COUNT(*) n FROM ledger_entries").get(), t.db.raw.prepare("SELECT COUNT(*) n FROM allocation_runs").get(), t.db.raw.prepare("SELECT id, quantity FROM inventory_items ORDER BY id").all()]);
    const before = fin();
    const res = await t.call("POST", "/api/intelligence/ai-eval/run", { cookie, body: { programId: "prog_pine_valley" } });
    expect(res.status).toBe(201);
    expect(run).toHaveBeenCalledTimes(BENCHMARK_DATASET.length);
    expect(res.json.metrics.fieldAccuracy).toBe(1);
    expect(fin()).toBe(before);
    const get = await t.call("GET", "/api/intelligence/ai-eval?programId=prog_pine_valley", { cookie });
    expect(get.json.latest.id).toBe(res.json.id);
    expect(get.json.latest.results).toHaveLength(BENCHMARK_DATASET.length);
    expect(t.db.raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'ai.benchmark_run'").get()).toEqual({ n: 1 });
  });

  it("is coordinator-only", async () => {
    const t = setup({ ai: { run: vi.fn() } });
    const m = await t.login("merchant");
    expect((await t.call("POST", "/api/intelligence/ai-eval/run", { cookie: m, body: { programId: "prog_pine_valley" } })).status).toBe(403);
    expect((await t.call("GET", "/api/intelligence/ai-eval?programId=prog_pine_valley", { cookie: m })).status).toBe(403);
  });
});
