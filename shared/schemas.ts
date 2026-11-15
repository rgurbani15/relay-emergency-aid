import { z } from "zod";
import { CATEGORY_IDS } from "./constants";

export const categorySchema = z.enum(CATEGORY_IDS);
const cents = z.number().int("Amount must be whole cents").positive("Amount must be greater than zero").max(100_000_000_00);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const programCreateSchema = z
  .object({
    name: z.string().trim().min(3, "Name is required").max(120),
    description: z.string().trim().max(1000).default(""),
    emergencyType: z.string().trim().min(2, "Emergency type is required").max(60),
    region: z.string().trim().min(2, "Region is required").max(80),
    startDate: isoDate,
    endDate: isoDate,
    budgetCents: cents,
    communityIds: z.array(z.string()).min(1, "Select at least one community"),
    categories: z.array(categorySchema).min(1, "Select at least one category"),
    status: z.enum(["draft", "active"]).default("draft"),
    restrictHomeCommunity: z.boolean().default(true),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End date must be on or after the start date" });

export const programUpdateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  endDate: isoDate.optional(),
  budgetCents: cents.optional(),
  restrictHomeCommunity: z.boolean().optional(),
});
export const programStatusSchema = z.object({ status: z.enum(["active", "paused", "closed"]), reason: z.string().trim().max(300).optional() });

export const communityUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  population: z.number().int().min(0).max(5_000_000).optional(),
  populationNeeding: z.number().int().min(0).max(5_000_000).optional(),
  needSeverity: z.number().int().min(0).max(100).optional(),
  marketAccessScore: z.number().int().min(0).max(100).optional(),
  merchantsNeeded: z.number().int().min(1).max(50).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const residentCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  communityId: z.string().min(1, "Community is required"),
  programId: z.string().min(1, "Program is required"),
  householdSize: z.number().int().min(1).max(20).default(1),
});
export const issueAssistanceSchema = z.object({
  amountCents: cents,
  eligibleCategories: z.array(categorySchema).min(1, "Select at least one category"),
  expiresAt: isoDate.optional(),
});

export const merchantCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  communityId: z.string().min(1, "Community is required"),
  category: z.string().trim().min(2, "Business category is required").max(40),
  capacityScore: z.number().int().min(0).max(100),
  status: z.enum(["open", "limited", "closed"]).default("open"),
});
export const merchantUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  communityId: z.string().optional(),
  category: z.string().trim().min(2).max(40).optional(),
  capacityScore: z.number().int().min(0).max(100).optional(),
  status: z.enum(["open", "limited", "closed"]).optional(),
  participating: z.boolean().optional(),
});

export const inventoryAdjustSchema = z.object({
  mode: z.enum(["set", "delta"]),
  value: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.enum(["restock", "adjustment", "correction"]),
  note: z.string().trim().max(200).optional(),
});
export const inventoryCreateSchema = z.object({
  merchantId: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  category: categorySchema,
  quantity: z.number().int().min(0).max(1_000_000),
  unit: z.string().trim().min(1).max(20),
  unitPriceCents: cents,
  minThreshold: z.number().int().min(0).max(1_000_000),
});

export const terminalBasketSchema = z.object({
  token: z.string().trim().min(6).max(64),
  items: z.array(z.object({ inventoryItemId: z.string().min(1), quantity: z.number().int().min(1).max(10_000) })).max(30),
});
export const redeemSchema = terminalBasketSchema.extend({ idempotencyKey: z.string().min(8).max(80) });
export const reverseSchema = z.object({ reason: z.string().trim().min(3, "A reason is required").max(300) });
export const decisionSchema = z.object({ reason: z.string().trim().min(3, "A reason is required").max(300) });

export const adjustmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("merchant_status"), merchantId: z.string().min(1), status: z.enum(["open", "limited", "closed"]) }),
  z.object({ kind: z.literal("shipment_delay"), communityId: z.string().min(1), category: categorySchema.optional(), quantity: z.number().int().positive().optional(), delayHours: z.number().int().min(1).max(168) }),
  z.object({ kind: z.literal("population_increase"), communityId: z.string().min(1), additionalResidents: z.number().int().min(1).max(100_000) }),
  z.object({ kind: z.literal("inventory_change"), communityId: z.string().min(1), category: categorySchema, mode: z.enum(["reduce_percent", "set_units", "delta_units"]), value: z.number().min(-1_000_000).max(1_000_000) }),
  z.object({ kind: z.literal("demand_multiplier"), communityId: z.string().optional(), category: categorySchema.optional(), multiplier: z.number().min(0.1).max(5) }),
]);
export const scenarioPreviewSchema = z.object({ programId: z.string().min(1), adjustments: z.array(adjustmentSchema).max(25) });
export const scenarioSaveSchema = scenarioPreviewSchema.extend({
  name: z.string().trim().min(3).max(100),
  source: z.enum(["manual", "ai"]).default("manual"),
  sourceText: z.string().max(2000).optional(),
  aiProposal: z.unknown().optional(),
  confirmed: z.literal(true, { message: "Scenario changes require explicit confirmation" }),
});
export const interpretSchema = z.object({ programId: z.string().min(1), text: z.string().trim().min(10, "Describe the incident in a sentence or two").max(1500) });
export const runAnalysisSchema = z.object({ programId: z.string().min(1), analysisDays: z.union([z.literal(21), z.literal(30)]).default(30) });

export type ProgramCreate = z.infer<typeof programCreateSchema>;

export const chatSchema = z.object({
  message: z.string().trim().min(1, "Type a question").max(800, "Keep questions under 800 characters"),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(8).default([]),
  programId: z.string().min(1).optional(),
});
