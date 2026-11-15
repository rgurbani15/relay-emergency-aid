import { Hono } from "hono";
import type { AppEnv } from "../env";
import { communityUpdateSchema } from "../../shared/schemas";
import { analyze } from "../../shared/engine";
import { all, auditStmt, first, type Row } from "../lib/db";
import { conflict, notFound, parse, readJson } from "../lib/http";
import { loadSnapshot } from "../services/snapshot";

export const communityRoutes = new Hono<AppEnv>();

function baseDto(c: Row) {
  return { id: c.id, name: c.name, regionId: c.region_id, population: c.population, populationNeeding: c.population_needing, needSeverity: c.need_severity, marketAccessScore: c.market_access_score, merchantsNeeded: c.merchants_needed, status: c.status, diagramX: c.diagram_x, diagramY: c.diagram_y, updatedAt: c.updated_at };
}

/** Community list with derived market scores (merchant coverage / capacity, inventory coverage, viability, risk) from the live engine. */
communityRoutes.get("/", async (c) => {
  const user = c.get("user");
  const programId = c.req.query("programId");
  const rows = await all<Row>(c.env.DB, programId ? `SELECT c.* FROM communities c JOIN program_communities pc ON pc.community_id = c.id WHERE c.org_id = ? AND pc.program_id = ? ORDER BY c.name` : "SELECT * FROM communities WHERE org_id = ? ORDER BY name", ...(programId ? [user.orgId, programId] : [user.orgId]));
  const live = programId ? analyze(await loadSnapshot(c.env.DB, programId, c.get("now")())) : null;
  return c.json({ items: rows.map((r) => ({ ...baseDto(r), live: live?.communities.find((x) => x.communityId === r.id) ?? null })) });
});

communityRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const r = await first<Row>(c.env.DB, "SELECT * FROM communities WHERE id = ? AND org_id = ?", c.req.param("id"), user.orgId);
  if (!r) throw notFound("Community");
  const programs = await all<Row>(c.env.DB, "SELECT p.id, p.name, p.status FROM programs p JOIN program_communities pc ON pc.program_id = p.id WHERE pc.community_id = ? ORDER BY p.created_at DESC", r.id);
  const programId = c.req.query("programId") ?? programs.find((p) => p.status === "active")?.id ?? programs[0]?.id;
  const live = programId ? analyze(await loadSnapshot(c.env.DB, programId, c.get("now")())).communities.find((x) => x.communityId === r.id) ?? null : null;
  const merchants = await all<Row>(c.env.DB, "SELECT id, name, category, status, participating, capacity_score FROM merchants WHERE community_id = ? ORDER BY name", r.id);
  const demand = await all<Row>(c.env.DB, "SELECT day, SUM(units_consumed) AS units FROM daily_demand_observations WHERE community_id = ? GROUP BY day ORDER BY day", r.id);
  const demandByCat = await all<Row>(c.env.DB, "SELECT day, category, units_consumed FROM daily_demand_observations WHERE community_id = ? ORDER BY day", r.id);
  const allocations = await all<Row>(c.env.DB, `SELECT a.id, a.status, a.created_at, ar.recommended_cents, ar.voucher_cents, ar.direct_cents, ar.market_viability FROM allocation_recommendations ar JOIN allocation_runs a ON a.id = ar.run_id WHERE ar.community_id = ? ORDER BY a.created_at DESC LIMIT 10`, r.id);
  return c.json({
    community: baseDto(r), programs, programId: programId ?? null, live,
    merchants: merchants.map((m) => ({ id: m.id, name: m.name, category: m.category, status: m.status, participating: !!m.participating, capacityScore: m.capacity_score })),
    demandTrend: demand.map((d) => ({ day: d.day, units: d.units })),
    demandByCategory: demandByCat.map((d) => ({ day: d.day, category: d.category, units: d.units_consumed })),
    allocations: allocations.map((a) => ({ runId: a.id, status: a.status, createdAt: a.created_at, recommendedCents: a.recommended_cents, voucherCents: a.voucher_cents, directCents: a.direct_cents, marketViability: a.market_viability })),
  });
});

communityRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const r = await first<Row>(c.env.DB, "SELECT * FROM communities WHERE id = ? AND org_id = ?", c.req.param("id"), user.orgId);
  if (!r) throw notFound("Community");
  const b = parse(communityUpdateSchema, await readJson(c.req.raw));
  const population = b.population ?? r.population, needing = b.populationNeeding ?? r.population_needing;
  if (needing > population) throw conflict("Population needing assistance cannot exceed total population.", "invalid_population");
  if (b.name && b.name !== r.name && (await first(c.env.DB, "SELECT id FROM communities WHERE org_id = ? AND name = ?", user.orgId, b.name))) throw conflict("A community with that name already exists.");
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE communities SET name = COALESCE(?, name), population = ?, population_needing = ?, need_severity = COALESCE(?, need_severity), market_access_score = COALESCE(?, market_access_score),
       merchants_needed = COALESCE(?, merchants_needed), status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
    ).bind(b.name ?? null, population, needing, b.needSeverity ?? null, b.marketAccessScore ?? null, b.merchantsNeeded ?? null, b.status ?? null, now, r.id),
    auditStmt(c.env.DB, user, "community.updated", "community", r.id, null, { changes: b }, now),
  ]);
  const updated = (await first<Row>(c.env.DB, "SELECT * FROM communities WHERE id = ?", r.id))!;
  return c.json({ community: baseDto(updated) });
});
