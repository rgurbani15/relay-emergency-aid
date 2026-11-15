export const CATEGORY_IDS = [
  "drinking_water",
  "food_packages",
  "medical_essentials",
  "first_aid",
  "blankets",
  "hygiene",
  "other_essentials",
] as const;
export type Category = (typeof CATEGORY_IDS)[number];

export interface CategoryMeta {
  id: Category;
  label: string;
  /** Base unit in which inventory and demand are both measured. */
  baseUnit: string;
  /** Criticality weight used when blending per-category inventory coverage. Sums to 1. */
  weight: number;
  /** Fallback unit price (cents) when a community has no priced stock in the category. */
  defaultPriceCents: number;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "drinking_water", label: "Drinking water", baseUnit: "gallon", weight: 0.3, defaultPriceCents: 399 },
  { id: "food_packages", label: "Food packages", baseUnit: "package", weight: 0.25, defaultPriceCents: 1850 },
  { id: "medical_essentials", label: "Medical essentials", baseUnit: "kit", weight: 0.15, defaultPriceCents: 2400 },
  { id: "first_aid", label: "First-aid supplies", baseUnit: "kit", weight: 0.1, defaultPriceCents: 1600 },
  { id: "blankets", label: "Blankets", baseUnit: "each", weight: 0.08, defaultPriceCents: 1800 },
  { id: "hygiene", label: "Hygiene supplies", baseUnit: "kit", weight: 0.08, defaultPriceCents: 1200 },
  { id: "other_essentials", label: "Other essentials", baseUnit: "each", weight: 0.04, defaultPriceCents: 900 },
];
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<Category, CategoryMeta>;
export const categoryLabel = (id: string) => CATEGORY_BY_ID[id as Category]?.label ?? id;

/** Weights and constants of the Market-Aware Aid Allocation Engine. Surfaced verbatim in the UI. */
export const ENGINE = {
  viabilityWeights: { marketAccess: 0.35, merchantCapacity: 0.25, inventoryCoverage: 0.4 },
  voucherShare: { base: 0.1, slope: 0.75, min: 0.1, max: 0.85 },
  priorityWeights: { population: 0.4, severity: 0.35, deficit: 0.25 },
  /** Eligible-need cap: people x base x (0.5 + severity) + projected shortage value. */
  perPersonBaseCents: 2500,
  horizonHours: 72,
  merchantStatusFactor: { open: 1, limited: 0.5, closed: 0 } as Record<string, number>,
  forecast: { alpha: 0.5, beta: 0.2, phi: 0.9, baselineWindow: 7, minTrainDays: 14 },
} as const;

export const STOCK_STATUSES = ["healthy", "low", "critical", "out_of_stock"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export function stockStatus(quantity: number, minThreshold: number): StockStatus {
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= minThreshold * 0.5) return "critical";
  if (quantity <= minThreshold) return "low";
  return "healthy";
}

export const ROLES = ["coordinator", "merchant", "resident"] as const;
export type Role = (typeof ROLES)[number];
