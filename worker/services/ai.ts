import { z } from "zod";
import { CATEGORY_IDS, categoryLabel, type Category } from "../../shared/constants";
import type { Adjustment } from "../../shared/engine";
import type { Env } from "../env";
import { DEFAULT_AI_MODEL } from "../config";
import { HttpError } from "../lib/http";

/**
 * RELAY AI Scenario Interpreter.
 * Workers AI only EXTRACTS a structured proposal from free text. It never writes to the database, never touches
 * balances/vouchers/allocations. The proposal is validated, grounded against the source text, resolved against
 * real community/merchant records, and shown to the coordinator for confirmation. The deterministic engine then
 * recomputes everything.
 */

const phrase = z.string().max(300).nullable().optional();
const conf = z.enum(["high", "medium", "low"]);

export const aiProposalSchema = z.object({
  community: z.object({ name: z.string().nullable(), sourcePhrase: phrase, confidence: conf }).nullable().default(null),
  category: z.object({ value: z.string().nullable(), sourcePhrase: phrase, confidence: conf }).nullable().default(null),
  delayedSupply: z.object({ quantity: z.number().int().positive().nullable(), sourcePhrase: phrase, confidence: conf }).nullable().default(null),
  delayHours: z.object({ value: z.number().positive().nullable(), sourcePhrase: phrase, confidence: conf }).nullable().default(null),
  additionalResidents: z.object({ value: z.number().int().positive().nullable(), sourcePhrase: phrase, confidence: conf }).nullable().default(null),
  merchantClosure: z.object({ merchantName: z.string().nullable(), sourcePhrase: phrase, confidence: conf }).nullable().default(null),
  missingInformation: z.array(z.string().max(200)).max(10).default([]),
  assumptions: z.array(z.string().max(200)).max(10).default([]),
});
export type AiProposal = z.infer<typeof aiProposalSchema>;

export interface AiContext {
  communities: { id: string; name: string }[];
  merchants: { id: string; name: string; communityId: string }[];
}

export interface InterpretedScenario {
  model: string;
  proposal: AiProposal;
  adjustments: Adjustment[];
  /** Per-field verification against the original text. Ungrounded values are dropped and reported, not guessed. */
  warnings: string[];
  requiresConfirmation: true;
}

const SYSTEM = `You extract structured scenario inputs from emergency incident reports for a relief-coordination tool.
Return ONLY a JSON object. Never invent numbers or names: if a value is not stated in the report, use null and add a note to "missingInformation".
Fields:
- community: {name, sourcePhrase, confidence} - the affected community name exactly as written.
- category: {value, sourcePhrase, confidence} - one of: ${CATEGORY_IDS.join(", ")} (map "water" to drinking_water, "food" to food_packages).
- delayedSupply: {quantity, sourcePhrase, confidence} - number of delayed supply units, only if a quantity is stated.
- delayHours: {value, sourcePhrase, confidence} - delay length in hours (convert days to hours).
- additionalResidents: {value, sourcePhrase, confidence} - extra residents expected, only if stated.
- merchantClosure: {merchantName, sourcePhrase, confidence} - a merchant reported closed or unavailable, only if stated.
- missingInformation: string[]; assumptions: string[].
sourcePhrase must be copied verbatim from the report. confidence is "high", "medium" or "low".`;

const jsonSchema = {
  type: "object",
  properties: {
    community: { type: ["object", "null"], properties: { name: { type: ["string", "null"] }, sourcePhrase: { type: ["string", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } } },
    category: { type: ["object", "null"], properties: { value: { type: ["string", "null"] }, sourcePhrase: { type: ["string", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } } },
    delayedSupply: { type: ["object", "null"], properties: { quantity: { type: ["integer", "null"] }, sourcePhrase: { type: ["string", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } } },
    delayHours: { type: ["object", "null"], properties: { value: { type: ["number", "null"] }, sourcePhrase: { type: ["string", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } } },
    additionalResidents: { type: ["object", "null"], properties: { value: { type: ["integer", "null"] }, sourcePhrase: { type: ["string", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } } },
    merchantClosure: { type: ["object", "null"], properties: { merchantName: { type: ["string", "null"] }, sourcePhrase: { type: ["string", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } } },
    missingInformation: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: ["missingInformation", "assumptions"],
};

/** Pull a JSON object out of whatever the model returned (object, JSON string, or fenced text). */
export function extractJson(raw: unknown): unknown {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if ("response" in r) return extractJson(r.response);
    return raw;
  }
  if (typeof raw !== "string") throw new Error("empty model output");
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("model output was not JSON");
  }
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const CATEGORY_ALIASES: Record<string, Category> = {
  water: "drinking_water", "drinking water": "drinking_water", drinking_water: "drinking_water",
  food: "food_packages", "food packages": "food_packages", food_packages: "food_packages",
  medical: "medical_essentials", medicine: "medical_essentials", "medical essentials": "medical_essentials", medical_essentials: "medical_essentials",
  "first aid": "first_aid", first_aid: "first_aid", "first-aid": "first_aid", blankets: "blankets", blanket: "blankets",
  hygiene: "hygiene", other: "other_essentials", other_essentials: "other_essentials",
};
export const resolveCategory = (v: string | null | undefined): Category | null => (v ? CATEGORY_ALIASES[norm(v).replace(/ /g, " ")] ?? CATEGORY_ALIASES[v.toLowerCase()] ?? null : null);

/** A number the model reports must literally appear in the report text (digits or number words), so quantities cannot be invented. */
export function numberAppears(text: string, n: number): boolean {
  const compact = text.replace(/,/g, "");
  if (new RegExp(`(^|[^0-9.])${n}([^0-9]|$)`).test(compact)) return true;
  const words: Record<number, string[]> = { 24: ["24", "twenty four", "twenty-four", "one day", "a day", "1 day"], 48: ["48", "forty eight", "forty-eight", "two days", "2 days"], 72: ["72", "three days", "3 days"], 12: ["twelve"], 36: ["thirty six", "thirty-six"] };
  return (words[n] ?? []).some((w) => text.toLowerCase().includes(w));
}

/** Delay hours are grounded if the hour figure appears, or it is a whole number of days that appears ("4 days" -> 96h). */
export function hoursAppear(text: string, hours: number): boolean {
  const h = Math.round(hours);
  return numberAppears(text, h) || (h > 0 && h % 24 === 0 && numberAppears(text, h / 24));
}

/** Validate + ground + resolve a raw model proposal into engine adjustments. Pure and unit-tested. */
export function buildScenarioFromProposal(rawJson: unknown, text: string, ctx: AiContext): Omit<InterpretedScenario, "model"> {
  const parsed = aiProposalSchema.safeParse(rawJson);
  if (!parsed.success) throw new HttpError(502, "ai_invalid_output", "The AI returned output in an unexpected format. Nothing was changed; use manual scenario controls instead.");
  const p = parsed.data;
  const warnings: string[] = [];
  const adjustments: Adjustment[] = [];
  const lower = text.toLowerCase();

  const grounded = (ph: string | null | undefined) => !ph || lower.includes(ph.toLowerCase().trim());
  let communityId: string | null = null;
  if (p.community?.name) {
    const found = ctx.communities.find((c) => norm(c.name) === norm(p.community!.name!)) ?? ctx.communities.find((c) => lower.includes(c.name.toLowerCase()) && norm(p.community!.name!).includes(norm(c.name)));
    if (!found) warnings.push(`Community "${p.community.name}" does not match any community in this program.`);
    else if (!lower.includes(found.name.toLowerCase())) warnings.push(`Community "${found.name}" is not named in the report.`);
    else communityId = found.id;
  }
  const category = resolveCategory(p.category?.value);
  if (p.category?.value && !category) warnings.push(`Category "${p.category.value}" is not a RELAY category.`);

  const qty = p.delayedSupply?.quantity ?? null;
  const qtyOk = qty !== null && numberAppears(text, qty);
  if (qty !== null && !qtyOk) warnings.push(`Quantity ${qty} does not appear in the report and was discarded.`);
  const hours = p.delayHours?.value ?? null;
  const hoursOk = hours !== null && hoursAppear(text, hours);
  if (hours !== null && !hoursOk) warnings.push(`Delay of ${hours}h does not appear in the report and was discarded.`);
  const extra = p.additionalResidents?.value ?? null;
  const extraOk = extra !== null && numberAppears(text, extra);
  if (extra !== null && !extraOk) warnings.push(`${extra} additional residents does not appear in the report and was discarded.`);
  for (const [label, ph] of [["community", p.community?.sourcePhrase], ["quantity", p.delayedSupply?.sourcePhrase], ["delay", p.delayHours?.sourcePhrase], ["residents", p.additionalResidents?.sourcePhrase]] as const) {
    if (ph && !grounded(ph)) warnings.push(`The quoted ${label} phrase was not found verbatim in the report.`);
  }

  if (communityId && hoursOk && hours !== null && (qtyOk || category)) {
    adjustments.push({ kind: "shipment_delay", communityId, category: category ?? undefined, quantity: qtyOk ? (qty as number) : undefined, delayHours: Math.round(hours) });
  } else if (hoursOk && !communityId) {
    warnings.push("A shipment delay was mentioned but no valid community was identified, so no delay was proposed.");
  }
  if (communityId && extraOk && extra !== null) adjustments.push({ kind: "population_increase", communityId, additionalResidents: extra });
  if (p.merchantClosure?.merchantName) {
    const m = ctx.merchants.find((x) => norm(x.name) === norm(p.merchantClosure!.merchantName!));
    if (m && lower.includes(m.name.toLowerCase())) adjustments.push({ kind: "merchant_status", merchantId: m.id, status: "closed" });
    else warnings.push(`Merchant "${p.merchantClosure.merchantName}" was not found in the participating network.`);
  }
  const missing = [...p.missingInformation];
  if (adjustments.length === 0) missing.push("No scenario adjustments could be confirmed from the report.");
  return { proposal: { ...p, missingInformation: missing }, adjustments, warnings, requiresConfirmation: true };
}

/** Calls the configured Workers AI model once and returns the raw output. Throws 503 if AI is unavailable. */
export async function callInterpreterModel(env: Env, text: string, ctx: AiContext): Promise<{ model: string; raw: unknown }> {
  if (!env.AI) throw new HttpError(503, "ai_unavailable", "Workers AI is not available in this environment. Use the manual scenario controls instead.");
  const model = env.AI_MODEL || DEFAULT_AI_MODEL;
  const context = `Known communities: ${ctx.communities.map((c) => c.name).join(", ")}.\nKnown merchants: ${ctx.merchants.map((m) => m.name).join(", ")}.`;
  try {
    const raw = await env.AI.run(model as never, {
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `${context}\n\nIncident report:\n"""${text}"""` }],
      response_format: { type: "json_schema", json_schema: jsonSchema },
      max_tokens: 700,
      temperature: 0,
    } as never);
    return { model, raw };
  } catch (err) {
    throw new HttpError(503, "ai_unavailable", `Workers AI could not be reached (${String((err as Error)?.message ?? err).slice(0, 120)}). Use the manual scenario controls instead.`);
  }
}

export async function interpretReport(env: Env, text: string, ctx: AiContext): Promise<InterpretedScenario> {
  const { model, raw } = await callInterpreterModel(env, text, ctx);
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    throw new HttpError(502, "ai_invalid_output", "The AI did not return valid JSON. Nothing was changed; use the manual scenario controls instead.");
  }
  return { model, ...buildScenarioFromProposal(json, text, ctx) };
}

export { categoryLabel };
