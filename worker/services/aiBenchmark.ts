import type { Category } from "../../shared/constants";
import type { Env } from "../env";
import { aiProposalSchema, callInterpreterModel, extractJson, hoursAppear, norm, numberAppears, resolveCategory, type AiContext, type AiProposal } from "./ai";

/**
 * AI evaluation benchmark. A SYNTHETIC set of incident reports, each with hand-written expected structured fields,
 * is run through the real Workers AI interpreter and scored. Every metric is computed from actual model output;
 * nothing is hardcoded. Results measure this synthetic set only; they are not a claim about real-world performance.
 */

export const DATASET_VERSION = "synthetic-v1";

export interface Expected {
  community: string | null;
  category: Category | null;
  delayedQuantity: number | null;
  delayHours: number | null;
  additionalResidents: number | null;
  merchantClosure: string | null;
}
export interface BenchmarkReport { id: string; tag: string; text: string; expected: Expected }

const N: Expected = { community: null, category: null, delayedQuantity: null, delayHours: null, additionalResidents: null, merchantClosure: null };
const r = (id: string, tag: string, text: string, e: Partial<Expected>): BenchmarkReport => ({ id, tag, text, expected: { ...N, ...e } });

export const BENCHMARK_DATASET: BenchmarkReport[] = [
  r("R01", "delayed shipment", "The water truck bound for Cedar Grove, carrying 400 units of drinking water, is delayed by 24 hours.", { community: "Cedar Grove", category: "drinking_water", delayedQuantity: 400, delayHours: 24 }),
  r("R02", "delayed shipment", "The food pallet for East Valley (300 food packages) will arrive two days late.", { community: "East Valley", category: "food_packages", delayedQuantity: 300, delayHours: 48 }),
  r("R03", "delayed shipment", "North Ridge's blanket delivery of 150 blankets is running 3 days behind schedule.", { community: "North Ridge", category: "blankets", delayedQuantity: 150, delayHours: 72 }),
  r("R04", "merchant closure", "Cedar Grove Grocers has shut its doors because of smoke damage to the building.", { merchantClosure: "Cedar Grove Grocers" }),
  r("R05", "merchant closure", "Pinecone Provisions is closed until further notice; its owner has evacuated.", { merchantClosure: "Pinecone Provisions" }),
  r("R06", "population increase", "About 250 more evacuees are expected to arrive in East Valley tonight.", { community: "East Valley", additionalResidents: 250 }),
  r("R07", "inventory reduction", "Valley Corner Store says its shelves of drinking water are almost empty.", {}),
  r("R08", "combined", "A truck carrying 400 units of drinking water to Cedar Grove is delayed by 24 hours, and another 120 residents are expected tomorrow.", { community: "Cedar Grove", category: "drinking_water", delayedQuantity: 400, delayHours: 24, additionalResidents: 120 }),
  r("R09", "multiple communities", "Evacuees from North Ridge are moving to Cedar Grove, so 180 additional residents are expected in Cedar Grove. North Ridge supplies are unaffected.", { community: "Cedar Grove", additionalResidents: 180 }),
  r("R10", "multiple communities", "East Valley and Cedar Grove both rely on the county warehouse. The 500 units of drinking water for East Valley are delayed 12 hours; Cedar Grove's delivery is on schedule.", { community: "East Valley", category: "drinking_water", delayedQuantity: 500, delayHours: 12 }),
  r("R11", "missing information", "The water shipment to East Valley is delayed by 36 hours, but nobody has said how many units are on it.", { community: "East Valley", category: "drinking_water", delayHours: 36 }),
  r("R12", "missing information", "A shipment of 200 hygiene kits to Cedar Grove is delayed and the new arrival time is unknown.", { community: "Cedar Grove", category: "hygiene", delayedQuantity: 200 }),
  r("R13", "ambiguous quantity", "Several hundred bottles of water for North Ridge are stuck at the depot and are probably a day late.", { community: "North Ridge", category: "drinking_water", delayHours: 24 }),
  r("R14", "unrelated numbers", "At the 3 pm briefing the sheriff said Highway 9 stays closed. Truck 7 carrying 350 cases of food for East Valley is delayed by 6 hours.", { community: "East Valley", category: "food_packages", delayedQuantity: 350, delayHours: 6 }),
  r("R15", "unrelated numbers", "Shelter 2 opened at 5 pm with room for 80 people. Medical supplies for Cedar Grove (60 units) are delayed 2 days.", { community: "Cedar Grove", category: "medical_essentials", delayedQuantity: 60, delayHours: 48 }),
  r("R16", "unrelated numbers", "The wildfire is 40 percent contained and winds are expected to reach 25 mph by evening.", {}),
  r("R17", "missing information", "Things are really bad out there, please send help as soon as you can.", {}),
  r("R18", "combined", "East Valley Supply Depot is closed and the 120 blankets heading to East Valley are delayed 24 hours.", { community: "East Valley", category: "blankets", delayedQuantity: 120, delayHours: 24, merchantClosure: "East Valley Supply Depot" }),
  r("R19", "delayed shipment", "Grocery deliveries of 250 food packages to North Ridge are two days late.", { community: "North Ridge", category: "food_packages", delayedQuantity: 250, delayHours: 48 }),
  r("R20", "delayed shipment", "First aid kits for Cedar Grove, 90 units in all, are delayed by 12 hours.", { community: "Cedar Grove", category: "first_aid", delayedQuantity: 90, delayHours: 12 }),
  r("R21", "combined", "Cedar Grove expects 300 more residents by Friday, and Grove Family Pharmacy has closed.", { community: "Cedar Grove", additionalResidents: 300, merchantClosure: "Grove Family Pharmacy" }),
  r("R22", "ambiguous quantity", "A lot more families are heading to East Valley and nobody knows how many.", { community: "East Valley" }),
  r("R23", "unknown community", "The shipment of 100 units of drinking water to Pine Hollow is delayed by 24 hours.", { category: "drinking_water", delayedQuantity: 100, delayHours: 24 }),
  r("R24", "inventory reduction", "Cedar Grove's drinking water stock dropped by 40 percent after panic buying.", { community: "Cedar Grove", category: "drinking_water" }),
  r("R25", "spelled-out numbers", "400 units of drinking water for Cedar Grove will be twenty-four hours late.", { community: "Cedar Grove", category: "drinking_water", delayedQuantity: 400, delayHours: 24 }),
  r("R26", "combined", "Flooding cut the road: the 500-unit drinking water order for East Valley is 4 days late, and 75 more residents are arriving.", { community: "East Valley", category: "drinking_water", delayedQuantity: 500, delayHours: 96, additionalResidents: 75 }),
  r("R27", "unknown merchant", "Sunrise Bakery in Cedar Grove has closed for the week.", { community: "Cedar Grove" }),
  r("R28", "merchant closure", "Summit Hardware & Supply closed early today, and North Ridge residents are being redirected to Ridgeline Market.", { community: "North Ridge", merchantClosure: "Summit Hardware & Supply" }),
];

export const FIELDS = ["community", "category", "delayedQuantity", "delayHours", "additionalResidents", "merchantClosure"] as const;
export type FieldName = (typeof FIELDS)[number];

export interface Extracted { community: string | null; category: Category | null; delayedQuantity: number | null; delayHours: number | null; additionalResidents: number | null; merchantClosure: string | null }

/** Reduce a model proposal to comparable values; also report which emitted values are not supported by the report/known records. */
export function extractFields(p: AiProposal, text: string, ctx: AiContext): { fields: Extracted; unsupported: FieldName[]; raw: Record<FieldName, unknown> } {
  const lower = text.toLowerCase();
  const unsupported: FieldName[] = [];
  const raw: Record<FieldName, unknown> = {
    community: p.community?.name ?? null, category: p.category?.value ?? null, delayedQuantity: p.delayedSupply?.quantity ?? null,
    delayHours: p.delayHours?.value ?? null, additionalResidents: p.additionalResidents?.value ?? null, merchantClosure: p.merchantClosure?.merchantName ?? null,
  };
  const known = (name: string | null | undefined) => (name ? ctx.communities.find((c) => norm(c.name) === norm(name)) : undefined);

  let community: string | null = null;
  if (raw.community) {
    const k = known(raw.community as string);
    if (k && lower.includes(k.name.toLowerCase())) community = k.name; else unsupported.push("community");
  }
  let category: Category | null = null;
  if (raw.category) { const c = resolveCategory(raw.category as string); if (c) category = c; else unsupported.push("category"); }
  let delayedQuantity: number | null = null;
  if (raw.delayedQuantity !== null) { if (numberAppears(text, raw.delayedQuantity as number)) delayedQuantity = raw.delayedQuantity as number; else unsupported.push("delayedQuantity"); }
  let delayHours: number | null = null;
  if (raw.delayHours !== null) { if (hoursAppear(text, raw.delayHours as number)) delayHours = Math.round(raw.delayHours as number); else unsupported.push("delayHours"); }
  let additionalResidents: number | null = null;
  if (raw.additionalResidents !== null) { if (numberAppears(text, raw.additionalResidents as number)) additionalResidents = raw.additionalResidents as number; else unsupported.push("additionalResidents"); }
  let merchantClosure: string | null = null;
  if (raw.merchantClosure) {
    const m = ctx.merchants.find((x) => norm(x.name) === norm(raw.merchantClosure as string));
    if (m && lower.includes(m.name.toLowerCase())) merchantClosure = m.name; else unsupported.push("merchantClosure");
  }
  return { fields: { community, category, delayedQuantity, delayHours, additionalResidents, merchantClosure }, unsupported, raw };
}

export type Outcome = "ok" | "invalid_json" | "schema_invalid" | "error";
export interface ReportResult {
  id: string; tag: string; text: string; expected: Expected; outcome: Outcome; latencyMs: number;
  /** Values the model emitted, after grounding (unsupported values are null here). */
  actual: Extracted | null;
  /** Raw values the model emitted before grounding. */
  emitted: Record<FieldName, unknown> | null;
  fieldCorrect: Record<FieldName, boolean> | null;
  unsupported: FieldName[]; missing: FieldName[]; errorMessage?: string;
}

/** Score a single parsed proposal against expectations. Pure. */
export function scoreProposal(report: BenchmarkReport, p: AiProposal, ctx: AiContext): Pick<ReportResult, "actual" | "emitted" | "fieldCorrect" | "unsupported" | "missing"> {
  const { fields, unsupported, raw } = extractFields(p, report.text, ctx);
  const fieldCorrect = {} as Record<FieldName, boolean>;
  const missing: FieldName[] = [];
  for (const f of FIELDS) {
    const exp = report.expected[f];
    const act = fields[f];
    fieldCorrect[f] = typeof exp === "string" && typeof act === "string" ? norm(exp) === norm(act) : exp === act;
    if (exp !== null && act === null && raw[f] === null) missing.push(f);
  }
  return { actual: fields, emitted: raw, fieldCorrect, unsupported, missing };
}

export interface Metrics {
  reports: number; evaluated: number; errored: number; parsed: number;
  fieldAccuracy: number; fieldsCorrect: number; fieldsTotal: number;
  perField: Record<FieldName, { correct: number; total: number; accuracy: number }>;
  invalidJsonRate: number; invalidJsonCount: number; schemaInvalidRate: number; schemaInvalidCount: number;
  unsupportedValueRate: number; unsupportedValues: number; emittedValues: number;
  missingFieldRate: number; missingFields: number; expectedFields: number;
  latencyMs: { mean: number; p50: number; p95: number; max: number };
}

const pctile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const rate = (n: number, d: number) => (d > 0 ? n / d : 0);

/** Aggregate real per-report results into metrics. Pure. Field accuracy counts only reports whose output parsed; failed reports count against the invalid-output rates instead. */
export function computeMetrics(results: ReportResult[]): Metrics {
  const answered = results.filter((x) => x.outcome !== "error");
  const parsed = answered.filter((x) => x.outcome === "ok");
  const perField = Object.fromEntries(FIELDS.map((f) => {
    const total = parsed.length; const correct = parsed.filter((x) => x.fieldCorrect?.[f]).length;
    return [f, { correct, total, accuracy: rate(correct, total) }];
  })) as Metrics["perField"];
  const fieldsTotal = parsed.length * FIELDS.length;
  const fieldsCorrect = FIELDS.reduce((s, f) => s + perField[f].correct, 0);
  const emitted = parsed.reduce((s, x) => s + FIELDS.filter((f) => x.emitted?.[f] !== null && x.emitted?.[f] !== undefined).length, 0);
  const unsupported = parsed.reduce((s, x) => s + x.unsupported.length, 0);
  const expectedFields = parsed.reduce((s, x) => s + FIELDS.filter((f) => x.expected[f] !== null).length, 0);
  const missing = parsed.reduce((s, x) => s + x.missing.length, 0);
  const lat = answered.map((x) => x.latencyMs);
  const invalidJson = answered.filter((x) => x.outcome === "invalid_json").length;
  const schemaInvalid = answered.filter((x) => x.outcome === "schema_invalid").length;
  return {
    reports: results.length, evaluated: answered.length, errored: results.length - answered.length, parsed: parsed.length,
    fieldAccuracy: rate(fieldsCorrect, fieldsTotal), fieldsCorrect, fieldsTotal, perField,
    invalidJsonRate: rate(invalidJson, answered.length), invalidJsonCount: invalidJson,
    schemaInvalidRate: rate(schemaInvalid, answered.length), schemaInvalidCount: schemaInvalid,
    unsupportedValueRate: rate(unsupported, emitted), unsupportedValues: unsupported, emittedValues: emitted,
    missingFieldRate: rate(missing, expectedFields), missingFields: missing, expectedFields,
    latencyMs: { mean: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0, p50: pctile(lat, 0.5), p95: pctile(lat, 0.95), max: lat.length ? Math.max(...lat) : 0 },
  };
}

/** Run the dataset through the real interpreter, one report at a time so latency is not distorted by concurrency. Read-only: writes nothing to financial records. */
export async function runBenchmark(env: Env, ctx: AiContext, dataset: BenchmarkReport[] = BENCHMARK_DATASET, clock: () => number = () => Date.now()): Promise<{ model: string; results: ReportResult[]; metrics: Metrics }> {
  const results: ReportResult[] = [];
  let model = env.AI_MODEL ?? "";
  for (const rep of dataset) {
    const base = { id: rep.id, tag: rep.tag, text: rep.text, expected: rep.expected, actual: null, emitted: null, fieldCorrect: null, unsupported: [] as FieldName[], missing: [] as FieldName[] };
    const t0 = clock();
    let called: { model: string; raw: unknown };
    try {
      called = await callInterpreterModel(env, rep.text, ctx);
    } catch (e) {
      if (results.length === 0) throw e; // nothing measured yet: surface "AI unavailable" instead of storing an empty run
      results.push({ ...base, outcome: "error", latencyMs: clock() - t0, errorMessage: String((e as Error).message).slice(0, 160) });
      continue;
    }
    const latencyMs = clock() - t0;
    model = called.model;
    let json: unknown;
    try { json = extractJson(called.raw); } catch { results.push({ ...base, outcome: "invalid_json", latencyMs }); continue; }
    const parsed = aiProposalSchema.safeParse(json);
    if (!parsed.success) { results.push({ ...base, outcome: "schema_invalid", latencyMs }); continue; }
    results.push({ ...base, outcome: "ok", latencyMs, ...scoreProposal(rep, parsed.data, ctx) });
  }
  return { model, results, metrics: computeMetrics(results) };
}
