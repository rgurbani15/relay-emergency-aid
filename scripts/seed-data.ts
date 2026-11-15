/**
 * Deterministic synthetic seed for RELAY. Everything here is fictional demonstration data.
 * `buildSeed(nowIso)` is pure: same input -> identical SQL. All financial totals reconcile:
 *   resident ledger sum   == sum(voucher.remaining_cents)
 *   merchant ledger sum   == sum(claims where status in pending/approved)
 *   inventory quantity    == opening stock - redemptions (movements are complete)
 */
import { CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS, stockStatus, type Category } from "../shared/constants";
import { analyze, type EngineSnapshot } from "../shared/engine";
import { forecastDailyDemand } from "../shared/forecast";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Row = Record<string, string | number | null>;
const lit = (v: string | number | null): string => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

export interface Seed { sql: string; tables: Record<string, Row[]>; snapshot: EngineSnapshot }

export const DEMO_IDS = {
  org: "org_relay_demo",
  program: "prog_pine_valley",
  coordinatorUser: "usr_coordinator",
  merchantUser: "usr_mer_1004", // Cedar Grove Grocers
  residentUser: "usr_res_1005", // Hannah Okafor, Cedar Grove
};

export function buildSeed(nowIso: string = new Date().toISOString()): Seed {
  const now = new Date(nowIso);
  const rnd = mulberry32(20261112);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const ago = (days: number, hours = 0) => iso(now.getTime() - days * DAY - hours * 3_600_000);
  const dayStr = (ms: number) => iso(ms).slice(0, 10);
  const t: Record<string, Row[]> = {};
  const add = (table: string, row: Row) => (t[table] ??= []).push(row);

  /* ---------- Organization, communities, program ---------- */
  add("organizations", { id: DEMO_IDS.org, name: "Pine Valley Relief Collaborative (Demo)", created_at: ago(40) });

  const communities = [
    { id: "com_north_ridge", name: "North Ridge", region: "PV-N", pop: 4800, needing: 1200, sev: 35, access: 88, needed: 3, x: 26, y: 26 },
    { id: "com_cedar_grove", name: "Cedar Grove", region: "PV-C", pop: 9500, needing: 2600, sev: 60, access: 62, needed: 4, x: 50, y: 56 },
    { id: "com_east_valley", name: "East Valley", region: "PV-E", pop: 11200, needing: 3400, sev: 90, access: 25, needed: 4, x: 78, y: 34 },
  ];
  for (const c of communities) {
    add("communities", { id: c.id, org_id: DEMO_IDS.org, name: c.name, region_id: c.region, population: c.pop, population_needing: c.needing, need_severity: c.sev, market_access_score: c.access, merchants_needed: c.needed, status: "active", diagram_x: c.x, diagram_y: c.y, created_at: ago(30), updated_at: ago(2) });
  }

  const allCats = JSON.stringify(CATEGORY_IDS);
  const programs = [
    { id: DEMO_IDS.program, name: "Pine Valley Wildfire Response", desc: "Illustrative emergency assistance program for communities affected by the Pine Valley wildfire. Synthetic demonstration data.", type: "Wildfire", region: "Pine Valley County", status: "active", budget: 12_000_000, start: ago(21), end: ago(-60) },
    { id: "prog_cedar_basin_flood", name: "Cedar Basin Flood Relief", desc: "Closed demonstration program from the prior season.", type: "Flood", region: "Cedar Basin", status: "closed", budget: 4_500_000, start: ago(300), end: ago(240) },
    { id: "prog_lakeshore_heat", name: "Lakeshore Heatwave Response", desc: "Paused demonstration program pending funding review.", type: "Extreme heat", region: "Lakeshore District", status: "paused", budget: 2_200_000, start: ago(120), end: ago(-30) },
    { id: "prog_harbor_winter", name: "Harbor Winter Storm Readiness", desc: "Draft program for pre-positioned winter storm assistance.", type: "Winter storm", region: "Harbor Coast", status: "draft", budget: 3_000_000, start: ago(-20), end: ago(-120) + "" },
  ];
  for (const p of programs) {
    add("programs", { id: p.id, org_id: DEMO_IDS.org, name: p.name, description: p.desc, emergency_type: p.type, region: p.region, status: p.status, budget_cents: p.budget, start_date: p.start.slice(0, 10), end_date: p.end.slice(0, 10) < p.start.slice(0, 10) ? ago(-150).slice(0, 10) : p.end.slice(0, 10), categories_json: allCats, restrict_home_community: 1, created_by: DEMO_IDS.coordinatorUser, created_at: p.start, updated_at: ago(3) });
  }
  for (const c of communities) add("program_communities", { program_id: DEMO_IDS.program, community_id: c.id });
  add("program_communities", { program_id: "prog_cedar_basin_flood", community_id: "com_cedar_grove" });
  add("program_communities", { program_id: "prog_lakeshore_heat", community_id: "com_north_ridge" });
  add("program_communities", { program_id: "prog_harbor_winter", community_id: "com_east_valley" });

  /* ---------- Merchants ---------- */
  const merchants = [
    { id: "MER-1001", com: "com_north_ridge", name: "Ridgeline Market", cat: "Grocery", status: "open", cap: 88, carries: ["drinking_water", "food_packages", "hygiene", "other_essentials"], mgr: "Ines Calder" },
    { id: "MER-1002", com: "com_north_ridge", name: "North Ridge Pharmacy", cat: "Pharmacy", status: "open", cap: 82, carries: ["medical_essentials", "first_aid", "hygiene"], mgr: "Owen Pruitt" },
    { id: "MER-1003", com: "com_north_ridge", name: "Summit Hardware & Supply", cat: "General goods", status: "open", cap: 80, carries: ["blankets", "other_essentials", "drinking_water", "first_aid"], mgr: "Rafa Mendes" },
    { id: "MER-1004", com: "com_cedar_grove", name: "Cedar Grove Grocers", cat: "Grocery", status: "open", cap: 72, carries: ["drinking_water", "food_packages", "hygiene", "other_essentials"], mgr: "Beatrice Lund" },
    { id: "MER-1005", com: "com_cedar_grove", name: "Grove Family Pharmacy", cat: "Pharmacy", status: "open", cap: 60, carries: ["medical_essentials", "first_aid", "hygiene"], mgr: "Anil Joshi" },
    { id: "MER-1006", com: "com_cedar_grove", name: "Pinecone Provisions", cat: "Convenience", status: "limited", cap: 55, carries: ["food_packages", "drinking_water", "blankets", "other_essentials"], mgr: "Yara Whitcomb" },
    { id: "MER-1007", com: "com_east_valley", name: "Valley Corner Store", cat: "Convenience", status: "limited", cap: 38, carries: ["drinking_water", "food_packages", "other_essentials", "hygiene"], mgr: "Sam Okonkwo" },
    { id: "MER-1008", com: "com_east_valley", name: "East Valley Supply Depot", cat: "General goods", status: "open", cap: 30, carries: ["blankets", "first_aid", "medical_essentials", "drinking_water"], mgr: "Lena Fischer" },
  ];
  for (const m of merchants) add("merchants", { id: m.id, org_id: DEMO_IDS.org, community_id: m.com, name: m.name, category: m.cat, status: m.status, participating: 1, capacity_score: m.cap, created_at: ago(25), updated_at: ago(1) });

  /* ---------- Residents ---------- */
  const residents = [
    { id: "RES-1001", com: "com_north_ridge", name: "Marisol Vega", hh: 4 },
    { id: "RES-1002", com: "com_north_ridge", name: "Tomas Reed", hh: 2 },
    { id: "RES-1003", com: "com_north_ridge", name: "Priya Nandakumar", hh: 5 },
    { id: "RES-1004", com: "com_north_ridge", name: "Elias Brandt", hh: 3 },
    { id: "RES-1005", com: "com_cedar_grove", name: "Hannah Okafor", hh: 4 },
    { id: "RES-1006", com: "com_cedar_grove", name: "Diego Salinas", hh: 6 },
    { id: "RES-1007", com: "com_cedar_grove", name: "Wendy Lau", hh: 2 },
    { id: "RES-1008", com: "com_cedar_grove", name: "Marcus Holloway", hh: 3 },
    { id: "RES-1009", com: "com_east_valley", name: "Fatima Rahimi", hh: 5 },
    { id: "RES-1010", com: "com_east_valley", name: "Jorge Castillo", hh: 4 },
    { id: "RES-1011", com: "com_east_valley", name: "Linh Tran", hh: 3 },
    { id: "RES-1012", com: "com_east_valley", name: "Gus Pedersen", hh: 2, suspended: true },
  ];
  for (const r of residents) add("residents", { id: r.id, org_id: DEMO_IDS.org, community_id: r.com, program_id: DEMO_IDS.program, name: r.name, household_size: r.hh, status: r.suspended ? "suspended" : "active", created_at: ago(19) });

  /* ---------- Users (synthetic demo accounts) ---------- */
  add("users", { id: DEMO_IDS.coordinatorUser, org_id: DEMO_IDS.org, role: "coordinator", name: "Dana Whitfield", email: "coordinator@relay.demo", merchant_id: null, resident_id: null, active: 1, created_at: ago(40) });
  for (const m of merchants) add("users", { id: `usr_mer_${m.id.slice(4)}`, org_id: DEMO_IDS.org, role: "merchant", name: m.mgr, email: `${m.id.toLowerCase()}@relay.demo`, merchant_id: m.id, resident_id: null, active: 1, created_at: ago(25) });
  for (const r of residents) add("users", { id: `usr_res_${r.id.slice(4)}`, org_id: DEMO_IDS.org, role: "resident", name: r.name, email: `${r.id.toLowerCase()}@relay.demo`, merchant_id: null, resident_id: r.id, active: 1, created_at: ago(19) });

  /* ---------- 30 days of synthetic daily demand ---------- */
  const perCapita: Record<Category, number> = { drinking_water: 0.85, food_packages: 0.5, medical_essentials: 0.04, first_aid: 0.03, blankets: 0.02, hygiene: 0.06, other_essentials: 0.05 };
  const history: Record<string, number[]> = {};
  const profile = (cid: string, cat: Category, i: number): number => {
    // multiplier relative to "current" daily demand (value at i=29 is ~1)
    if (cid === "com_cedar_grove") {
      const g = cat === "drinking_water" || cat === "food_packages" ? 0.025 : 0.01;
      return (1 + g * i) / (1 + g * 29);
    }
    if (cid === "com_east_valley") return i < 10 ? 0.6 + 0.04 * i : 1 + 0.004 * (i - 10) - 0.0076;
    return cat === "blankets" ? 1.2 - 0.0068 * i : 1;
  };
  const sigma: Record<string, number> = { com_north_ridge: 0.05, com_cedar_grove: 0.07, com_east_valley: 0.09 };
  for (const c of communities) {
    for (const cat of CATEGORY_IDS) {
      const series: number[] = [];
      for (let i = 0; i < 30; i++) {
        const base = c.needing * perCapita[cat];
        const v = Math.max(0, Math.round(base * profile(c.id, cat, i) * (1 + sigma[c.id] * gauss())));
        series.push(v);
        add("daily_demand_observations", { id: `obs_${c.id.slice(4)}_${cat}_${i}`, community_id: c.id, category: cat, day: dayStr(now.getTime() - (30 - i) * DAY), units_consumed: v });
      }
      history[`${c.id}|${cat}`] = series;
    }
  }

  /* ---------- Inventory (sized from forecast demand so the narrative holds) ---------- */
  const coverageTarget: Record<string, Record<Category, number>> = {
    com_north_ridge: { drinking_water: 1.5, food_packages: 1.4, medical_essentials: 1.5, first_aid: 1.3, blankets: 1.6, hygiene: 1.4, other_essentials: 1.3 },
    com_cedar_grove: { drinking_water: 0.5, food_packages: 0.95, medical_essentials: 0.85, first_aid: 0.9, blankets: 1.1, hygiene: 0.8, other_essentials: 1.0 },
    com_east_valley: { drinking_water: 0.16, food_packages: 0.28, medical_essentials: 0.25, first_aid: 0.3, blankets: 0.5, hygiene: 0.22, other_essentials: 0.3 },
  };
  const itemNames: Record<Category, { name: string; unit: string }[]> = {
    drinking_water: [{ name: "Spring water, 1 gal", unit: "gallon" }],
    food_packages: [{ name: "Emergency food pack (1 person-day)", unit: "package" }],
    medical_essentials: [{ name: "Medical essentials kit", unit: "kit" }],
    first_aid: [{ name: "Family first-aid kit", unit: "kit" }],
    blankets: [{ name: "Thermal blanket", unit: "each" }],
    hygiene: [{ name: "Hygiene kit", unit: "kit" }],
    other_essentials: [{ name: "Flashlight & batteries set", unit: "each" }],
  };
  interface Inv { id: string; merchantId: string; communityId: string; name: string; category: Category; unit: string; price: number; qty: number; min: number; opening: number }
  const inventory: Inv[] = [];
  let invN = 0;
  for (const c of communities) {
    for (const cat of CATEGORY_IDS) {
      const f72 = forecastDailyDemand(history[`${c.id}|${cat}`], 3).reduce((a, b) => a + b, 0);
      const total = Math.round(coverageTarget[c.id][cat] * f72);
      const carriers = merchants.filter((m) => m.com === c.id && m.carries.includes(cat));
      const wsum = carriers.reduce((s, m) => s + m.cap, 0);
      let left = total;
      carriers.forEach((m, idx) => {
        let q = idx === carriers.length - 1 ? left : Math.round((total * m.cap) / wsum);
        q = Math.max(0, Math.min(left, q));
        left -= q;
        const meta = itemNames[cat][0];
        const price = Math.round(CATEGORY_BY_ID[cat].defaultPriceCents * (0.95 + 0.15 * rnd()) / 5) * 5 - 1;
        const dailyShare = (history[`${c.id}|${cat}`].slice(-3).reduce((a, b) => a + b, 0) / 3) / carriers.length;
        inventory.push({ id: `inv_${String(++invN).padStart(3, "0")}`, merchantId: m.id, communityId: c.id, name: meta.name, category: cat, unit: meta.unit, price, qty: q, min: Math.max(5, Math.round(dailyShare * 0.8)), opening: q });
      });
    }
  }
  // Deterministic edge cases that exercise every stock status in the UI.
  const evWater = inventory.find((i) => i.merchantId === "MER-1007" && i.category === "drinking_water");
  if (evWater) { const moved = evWater.qty; evWater.qty = 0; evWater.opening = 0; const depot = inventory.find((i) => i.merchantId === "MER-1008" && i.category === "drinking_water"); if (depot) { depot.qty += moved; depot.opening += moved; } }

  /* ---------- Vouchers ---------- */
  interface V { id: string; code: string; resident: string; amount: number; remaining: number; eligible: Category[]; issuedAt: string; expires: string; nonce: string }
  const vouchers: V[] = [];
  const hex = () => Array.from({ length: 16 }, () => Math.floor(rnd() * 16).toString(16)).join("");
  const activeResidents = residents.filter((r) => !r.suspended);
  activeResidents.forEach((r, idx) => {
    const amount = 30_000 + ((idx * 7) % 5) * 5_000; // $300-$500
    vouchers.push({ id: `vch_${String(vouchers.length + 1).padStart(4, "0")}`, code: `VCH-${String(vouchers.length + 1).padStart(4, "0")}`, resident: r.id, amount, remaining: amount, eligible: [...CATEGORY_IDS], issuedAt: ago(17, idx), expires: ago(-45), nonce: hex() });
    if (idx % 2 === 0) {
      const a2 = 15_000 + (idx % 3) * 5_000;
      vouchers.push({ id: `vch_${String(vouchers.length + 1).padStart(4, "0")}`, code: `VCH-${String(vouchers.length + 1).padStart(4, "0")}`, resident: r.id, amount: a2, remaining: a2, eligible: ["drinking_water", "food_packages", "hygiene"], issuedAt: ago(9, idx), expires: ago(-30), nonce: hex() });
    }
  });

  /* ---------- Redemptions, ledger, claims ---------- */
  interface Red { id: string; no: string; voucher: V; resident: string; merchantId: string; communityId: string; amount: number; at: number; items: { inv: Inv; qty: number; total: number }[]; claimId?: string }
  const reds: Red[] = [];
  const merchantsByCom = (cid: string) => merchants.filter((m) => m.com === cid);
  const times: number[] = [];
  for (let d = 14; d >= 0; d--) {
    const n = d === 0 ? 1 : 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) times.push(now.getTime() - d * DAY - (3 + Math.floor(rnd() * 9)) * 3_600_000 + k * 600_000);
  }
  times.sort((a, b) => a - b);
  const lineQty: Record<Category, [number, number]> = { drinking_water: [6, 18], food_packages: [3, 8], medical_essentials: [1, 2], first_aid: [1, 2], blankets: [1, 3], hygiene: [1, 3], other_essentials: [1, 3] };
  for (const at of times) {
    const res = activeResidents[Math.floor(rnd() * activeResidents.length)];
    const open = merchantsByCom(res.com).filter((m) => m.status !== "closed");
    const mer = open[Math.floor(rnd() * open.length)];
    const myV = vouchers.filter((v) => v.resident === res.id && v.remaining > 0 && Date.parse(v.issuedAt) <= at);
    if (myV.length === 0) continue;
    const v = myV[Math.floor(rnd() * myV.length)];
    const pool = inventory.filter((i) => i.merchantId === mer.id && v.eligible.includes(i.category) && i.qty >= 40);
    if (pool.length === 0) continue;
    const lines: Red["items"] = [];
    const nLines = 1 + Math.floor(rnd() * Math.min(3, pool.length));
    const chosen = [...pool].sort(() => rnd() - 0.5).slice(0, nLines);
    let amount = 0;
    for (const inv of chosen) {
      const [lo, hi] = lineQty[inv.category];
      const qty = lo + Math.floor(rnd() * (hi - lo + 1));
      lines.push({ inv, qty, total: qty * inv.price });
      amount += qty * inv.price;
    }
    // Keep at least 40% of every voucher unspent so the demo residents still have meaningful balances.
    if (amount > v.remaining || v.remaining - amount < v.amount * 0.4) continue;
    v.remaining -= amount;
    for (const l of lines) { l.inv.qty -= l.qty; }
    reds.push({ id: `red_${String(reds.length + 1).padStart(4, "0")}`, no: `RCP-${String(reds.length + 1).padStart(6, "0")}`, voucher: v, resident: res.id, merchantId: mer.id, communityId: mer.com, amount, at, items: lines });
  }
  // `inv.opening` is the stock before any redemption; `inv.qty` is the current stock.

  for (const i of inventory) {
    add("inventory_items", { id: i.id, merchant_id: i.merchantId, community_id: i.communityId, name: i.name, category: i.category, quantity: i.qty, unit: i.unit, unit_price_cents: i.price, min_threshold: i.min, updated_at: ago(1) });
    if (i.opening > 0) add("inventory_movements", { id: `mov_${i.id}_open`, inventory_item_id: i.id, merchant_id: i.merchantId, community_id: i.communityId, delta: i.opening, quantity_after: i.opening, reason: "opening_stock", note: "Initial stock recorded at program onboarding", ref_id: null, actor_user_id: DEMO_IDS.coordinatorUser, created_at: ago(16) });
  }
  // Running quantity per item for redemption movements.
  const running = new Map(inventory.map((i) => [i.id, i.opening]));

  // Claims: older redemptions are decided; recent ones sit in an open pending claim per merchant.
  interface Claim { id: string; merchantId: string; status: "pending" | "approved" | "rejected"; reds: Red[]; createdAt: string; decidedAt: string | null; reason: string | null }
  const claims: Claim[] = [];
  let rejectedGiven = false;
  for (const m of merchants) {
    const mine = reds.filter((r) => r.merchantId === m.id).sort((a, b) => a.at - b.at);
    if (mine.length === 0) continue;
    const bucket = (r: Red) => (r.at < now.getTime() - 9 * DAY ? 0 : r.at < now.getTime() - 4 * DAY ? 1 : 2);
    for (const b of [0, 1, 2]) {
      const group = mine.filter((r) => bucket(r) === b);
      if (group.length === 0) continue;
      let status: Claim["status"] = b === 2 ? "pending" : "approved";
      let reason: string | null = null;
      if (b === 1 && !rejectedGiven) { status = "rejected"; reason = "Basket total did not match the voucher receipt; please resubmit with corrected line items."; rejectedGiven = true; }
      const last = group[group.length - 1].at;
      claims.push({ id: `CLM-${String(claims.length + 1).padStart(4, "0")}`, merchantId: m.id, status, reds: group, createdAt: iso(group[0].at), decidedAt: status === "pending" ? null : iso(last + DAY), reason });
    }
  }
  for (const c of claims) for (const r of c.reds) r.claimId = c.id;

  for (const v of vouchers) {
    add("vouchers", { id: v.id, public_code: v.code, program_id: DEMO_IDS.program, resident_id: v.resident, amount_cents: v.amount, remaining_cents: v.remaining, eligible_categories_json: JSON.stringify(v.eligible), status: v.remaining === 0 ? "exhausted" : "active", nonce: v.nonce, version: reds.filter((r) => r.voucher.id === v.id).length, issued_at: v.issuedAt, expires_at: v.expires });
  }
  for (const c of claims) {
    add("reimbursement_claims", { id: c.id, merchant_id: c.merchantId, program_id: DEMO_IDS.program, amount_cents: c.reds.reduce((s, r) => s + r.amount, 0), item_count: c.reds.length, status: c.status, rejection_reason: c.reason, created_at: c.createdAt, decided_at: c.decidedAt, decided_by: c.decidedAt ? DEMO_IDS.coordinatorUser : null });
  }
  let ledgerN = 0;
  const ledger = (row: Row) => add("ledger_entries", { id: `led_${String(++ledgerN).padStart(5, "0")}`, ...row } as Row);
  for (const v of vouchers) ledger({ program_id: DEMO_IDS.program, account_type: "resident", resident_id: v.resident, merchant_id: null, voucher_id: v.id, redemption_id: null, entry_type: "assistance_issued", amount_cents: v.amount, memo: `Assistance issued ${v.code}`, reverses_entry_id: null, created_by: DEMO_IDS.coordinatorUser, created_at: v.issuedAt });
  const claimLedgerIds = new Map<string, string>();
  for (const r of reds) {
    add("redemptions", { id: r.id, receipt_no: r.no, program_id: DEMO_IDS.program, voucher_id: r.voucher.id, resident_id: r.resident, merchant_id: r.merchantId, community_id: r.communityId, claim_id: r.claimId!, amount_cents: r.amount, status: "completed", idempotency_key: `seed-${r.id}`, created_by: `usr_mer_${r.merchantId.slice(4)}`, created_at: iso(r.at), reversed_at: null, reversal_reason: null });
    r.items.forEach((l, n) => {
      add("redemption_items", { id: `${r.id}_i${n + 1}`, redemption_id: r.id, inventory_item_id: l.inv.id, item_name: l.inv.name, category: l.inv.category, quantity: l.qty, unit_price_cents: l.inv.price, line_total_cents: l.total });
      const after = (running.get(l.inv.id) ?? 0) - l.qty;
      running.set(l.inv.id, after);
      add("inventory_movements", { id: `mov_${r.id}_${n + 1}`, inventory_item_id: l.inv.id, merchant_id: l.inv.merchantId, community_id: l.inv.communityId, delta: -l.qty, quantity_after: after, reason: "redemption", note: `Voucher redemption ${r.no}`, ref_id: r.id, actor_user_id: `usr_mer_${r.merchantId.slice(4)}`, created_at: iso(r.at) });
    });
    add("reimbursement_items", { id: `${r.claimId}_${r.id}`, claim_id: r.claimId!, redemption_id: r.id, amount_cents: r.amount, voided: 0 });
    ledger({ program_id: DEMO_IDS.program, account_type: "resident", resident_id: r.resident, merchant_id: null, voucher_id: r.voucher.id, redemption_id: r.id, entry_type: "voucher_redeemed", amount_cents: -r.amount, memo: `Redeemed at ${merchants.find((m) => m.id === r.merchantId)!.name} (${r.no})`, reverses_entry_id: null, created_by: `usr_mer_${r.merchantId.slice(4)}`, created_at: iso(r.at) });
    claimLedgerIds.set(r.id, `led_${String(ledgerN + 1).padStart(5, "0")}`);
    ledger({ program_id: DEMO_IDS.program, account_type: "merchant", resident_id: null, merchant_id: r.merchantId, voucher_id: r.voucher.id, redemption_id: r.id, entry_type: "reimbursement_claim_created", amount_cents: r.amount, memo: `Claim ${r.claimId} for ${r.no}`, reverses_entry_id: null, created_by: `usr_mer_${r.merchantId.slice(4)}`, created_at: iso(r.at) });
  }
  for (const c of claims.filter((x) => x.status === "rejected")) {
    for (const r of c.reds) ledger({ program_id: DEMO_IDS.program, account_type: "merchant", resident_id: null, merchant_id: r.merchantId, voucher_id: r.voucher.id, redemption_id: r.id, entry_type: "reimbursement_claim_reversed", amount_cents: -r.amount, memo: `Claim ${c.id} rejected`, reverses_entry_id: claimLedgerIds.get(r.id)!, created_by: DEMO_IDS.coordinatorUser, created_at: c.decidedAt! });
  }

  /* ---------- Planned shipments ---------- */
  const hoursAhead = (h: number) => iso(now.getTime() + h * 3_600_000);
  const shipments = [
    { id: "shp_001", com: "com_cedar_grove", mer: "MER-1004", cat: "drinking_water" as Category, qty: 400, h: 24, label: "Water truck from Regional Relief Warehouse" },
    { id: "shp_002", com: "com_cedar_grove", mer: "MER-1006", cat: "food_packages" as Category, qty: 300, h: 36, label: "Food pack pallet (county partner)" },
    { id: "shp_003", com: "com_east_valley", mer: "MER-1008", cat: "drinking_water" as Category, qty: 600, h: 48, label: "Convoy 2: bottled water" },
    { id: "shp_004", com: "com_east_valley", mer: "MER-1007", cat: "food_packages" as Category, qty: 250, h: 60, label: "Convoy 2: shelf-stable food" },
    { id: "shp_005", com: "com_north_ridge", mer: "MER-1003", cat: "blankets" as Category, qty: 200, h: 30, label: "Blanket restock" },
  ];
  for (const s of shipments) add("planned_shipments", { id: s.id, community_id: s.com, merchant_id: s.mer, category: s.cat, quantity: s.qty, eta: hoursAhead(s.h), status: "in_transit", label: s.label });

  /* ---------- Engine snapshot + historical allocation runs ---------- */
  const issued = vouchers.reduce((s, v) => s + v.amount, 0);
  const snapshotAt = (truncate: number, asOf: string): EngineSnapshot => ({
    asOf,
    program: { id: DEMO_IDS.program, name: programs[0].name, budgetCents: programs[0].budget, committedCents: issued },
    communities: communities.map((c) => ({ id: c.id, name: c.name, populationNeeding: c.needing, needSeverity: c.sev, marketAccess: c.access, merchantsNeeded: c.needed, diagramX: c.x, diagramY: c.y })),
    merchants: merchants.map((m) => ({ id: m.id, communityId: m.com, name: m.name, status: m.status as "open" | "limited" | "closed", capacityScore: m.cap, participating: true })),
    inventory: inventory.map((i) => ({ id: i.id, merchantId: i.merchantId, communityId: i.communityId, category: i.category, quantity: i.qty, unitPriceCents: i.price, name: i.name })),
    shipments: shipments.map((s) => ({ id: s.id, communityId: s.com, category: s.cat, quantity: s.qty, etaHours: s.h, label: s.label })),
    history: Object.fromEntries(Object.entries(history).map(([k, v]) => [k, truncate ? v.slice(0, -truncate) : v])),
  });

  const runs = [
    { id: "alr_0001", status: "approved", at: ago(9), snap: snapshotAt(9, ago(9)), decidedAt: ago(8, 20), by: DEMO_IDS.coordinatorUser, reason: null as string | null },
    { id: "alr_0002", status: "pending_approval", at: ago(0, 3), snap: snapshotAt(0, ago(0, 3)), decidedAt: null, by: null, reason: null },
  ];
  for (const run of runs) {
    const res = analyze(run.snap);
    add("allocation_runs", { id: run.id, program_id: DEMO_IDS.program, status: run.status, analysis_days: 30, budget_basis_cents: res.budgetBasisCents, total_recommended_cents: res.totals.recommendedCents, voucher_cents: res.totals.voucherCents, direct_supply_cents: res.totals.directCents, unallocated_cents: res.totals.unallocatedCents, communities_evaluated: res.communities.length, inputs_json: JSON.stringify(run.snap), metrics_json: JSON.stringify({ forecastEvaluation: res.forecastEvaluation, totals: res.totals, notes: res.notes }), scenario_run_id: null, created_by: DEMO_IDS.coordinatorUser, created_at: run.at, decided_by: run.by, decided_at: run.decidedAt, decision_reason: run.reason });
    for (const c of res.communities) {
      add("allocation_recommendations", { id: `${run.id}_${c.communityId}`, run_id: run.id, community_id: c.communityId, market_viability: c.marketViability, priority_share: c.priorityShare, recommended_cents: c.recommendedCents, voucher_pct: c.voucherPct, direct_pct: c.directPct, voucher_cents: c.voucherCents, direct_cents: c.directCents, detail_json: JSON.stringify(c) });
      for (const ca of c.categories) {
        const f = [ca.forecast24, ca.forecast48, ca.forecast72];
        [24, 48, 72].forEach((h, k) => add("demand_forecasts", { id: `${run.id}_${c.communityId}_${ca.category}_${h}`, allocation_run_id: run.id, community_id: c.communityId, category: ca.category, horizon_hours: h, forecast_units: Math.round(f[k] * 100) / 100, method: "damped_holt_v1", generated_at: run.at }));
      }
    }
  }

  /* ---------- Audit log ---------- */
  let auditN = 0;
  const audit = (ts: string, actor: { id: string; name: string; role: string }, action: string, entityType: string, entityId: string | null, meta: Record<string, unknown>) =>
    add("audit_logs", { id: `aud_${String(++auditN).padStart(5, "0")}`, org_id: DEMO_IDS.org, actor_user_id: actor.id, actor_name: actor.name, actor_role: actor.role, action, entity_type: entityType, entity_id: entityId, program_id: DEMO_IDS.program, metadata_json: JSON.stringify(meta), created_at: ts });
  const coord = { id: DEMO_IDS.coordinatorUser, name: "Dana Whitfield", role: "coordinator" };
  audit(ago(21), coord, "program.created", "program", DEMO_IDS.program, { name: programs[0].name, budgetCents: programs[0].budget });
  for (const m of merchants) audit(ago(20), coord, "merchant.registered", "merchant", m.id, { name: m.name, community: m.com });
  for (const r of residents) audit(ago(19), coord, "resident.registered", "resident", r.id, { community: r.com });
  for (const v of vouchers) audit(v.issuedAt, coord, "voucher.issued", "voucher", v.id, { code: v.code, resident: v.resident, amountCents: v.amount });
  for (const r of reds) audit(iso(r.at), { id: `usr_mer_${r.merchantId.slice(4)}`, name: merchants.find((m) => m.id === r.merchantId)!.name, role: "merchant" }, "voucher.redeemed", "redemption", r.id, { receipt: r.no, amountCents: r.amount, voucher: r.voucher.code });
  audit(runs[0].at, coord, "allocation.generated", "allocation_run", "alr_0001", { communities: 3 });
  audit(runs[0].decidedAt!, coord, "allocation.approved", "allocation_run", "alr_0001", {});
  for (const c of claims.filter((x) => x.decidedAt)) audit(c.decidedAt!, coord, c.status === "approved" ? "claim.approved" : "claim.rejected", "claim", c.id, { amountCents: c.reds.reduce((s, r) => s + r.amount, 0), reason: c.reason });
  audit(runs[1].at, coord, "allocation.generated", "allocation_run", "alr_0002", { communities: 3 });

  /* ---------- SQL ---------- */
  const ORDER = ["organizations", "communities", "programs", "program_communities", "merchants", "residents", "users", "vouchers", "inventory_items", "inventory_movements", "reimbursement_claims", "redemptions", "redemption_items", "reimbursement_items", "ledger_entries", "planned_shipments", "daily_demand_observations", "allocation_runs", "allocation_recommendations", "demand_forecasts", "audit_logs"];
  const out: string[] = ["-- RELAY synthetic seed. Generated by scripts/generate-seed.ts. All data is fictional.", ""];
  for (const table of ORDER) {
    const rows = t[table] ?? [];
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const chunk = table === "allocation_runs" || table === "allocation_recommendations" ? 1 : 20;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk).map((r) => `(${cols.map((c) => lit(r[c] ?? null)).join(", ")})`).join(",\n  ");
      out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES\n  ${part};`);
    }
  }
  void stockStatus;
  return { sql: out.join("\n") + "\n", tables: t, snapshot: snapshotAt(0, nowIso) };
}
