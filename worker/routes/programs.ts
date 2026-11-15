import { Hono } from "hono";
import type { AppEnv } from "../env";
import { programCreateSchema, programStatusSchema, programUpdateSchema } from "../../shared/schemas";
import { all, auditStmt, first, likeTerm, pageOf, type Row } from "../lib/db";
import { shortId } from "../lib/crypto";
import { conflict, notFound, parse, readJson, badRequest } from "../lib/http";
import { PROGRAM_STATS_SQL, getProgram, listProgramsLite, programDto } from "../services/stats";

export const programRoutes = new Hono<AppEnv>();

programRoutes.get("/lite", async (c) => c.json({ programs: await listProgramsLite(c.env.DB, c.get("user").orgId) }));

programRoutes.get("/", async (c) => {
  const q = c.req.query();
  const { page, pageSize, offset } = pageOf(q);
  const where = ["p.org_id = ?"], params: unknown[] = [c.get("user").orgId];
  if (q.q) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.region LIKE ? ESCAPE '\\' OR p.emergency_type LIKE ? ESCAPE '\\')"); params.push(likeTerm(q.q), likeTerm(q.q), likeTerm(q.q)); }
  if (q.status && q.status !== "all") { where.push("p.status = ?"); params.push(q.status); }
  const sorts: Record<string, string> = { name: "p.name", budget: "p.budget_cents", allocated: "allocated_cents", redeemed: "redeemed_cents", start: "p.start_date", end: "p.end_date", status: "p.status" };
  const sort = sorts[q.sort ?? ""] ?? "p.created_at";
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const total = (await first<Row>(c.env.DB, `SELECT COUNT(*) n FROM programs p WHERE ${where.join(" AND ")}`, ...params))!.n;
  const rows = await all<Row>(c.env.DB, `${PROGRAM_STATS_SQL} WHERE ${where.join(" AND ")} ORDER BY ${sort} ${dir}, p.id LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  return c.json({ items: rows.map(programDto), total, page, pageSize });
});

programRoutes.post("/", async (c) => {
  const user = c.get("user");
  const b = parse(programCreateSchema, await readJson(c.req.raw));
  const ph = b.communityIds.map(() => "?").join(",");
  const found = await all<Row>(c.env.DB, `SELECT id FROM communities WHERE org_id = ? AND id IN (${ph})`, user.orgId, ...b.communityIds);
  if (found.length !== new Set(b.communityIds).size) throw badRequest("One or more selected communities do not exist in your organization");
  const id = shortId("prog");
  const now = c.get("now")().toISOString();
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO programs (id, org_id, name, description, emergency_type, region, status, budget_cents, start_date, end_date, categories_json, restrict_home_community, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.orgId, b.name, b.description, b.emergencyType, b.region, b.status, b.budgetCents, b.startDate, b.endDate, JSON.stringify(b.categories), b.restrictHomeCommunity ? 1 : 0, user.id, now, now),
    ...[...new Set(b.communityIds)].map((cid) => c.env.DB.prepare("INSERT INTO program_communities (program_id, community_id) VALUES (?, ?)").bind(id, cid)),
    auditStmt(c.env.DB, user, "program.created", "program", id, id, { name: b.name, budgetCents: b.budgetCents, communities: b.communityIds.length, status: b.status }, now),
  ];
  await c.env.DB.batch(stmts);
  return c.json({ program: await getProgram(c.env.DB, user.orgId, id) }, 201);
});

programRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const program = await getProgram(c.env.DB, user.orgId, c.req.param("id"));
  if (!program) throw notFound("Program");
  const communities = await all<Row>(c.env.DB, `SELECT c.id, c.name, c.population_needing, c.need_severity FROM communities c JOIN program_communities pc ON pc.community_id = c.id WHERE pc.program_id = ? ORDER BY c.name`, program.id);
  return c.json({ program, communities: communities.map((x) => ({ id: x.id, name: x.name, populationNeeding: x.population_needing, needSeverity: x.need_severity })) });
});

programRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const program = await getProgram(c.env.DB, user.orgId, c.req.param("id"));
  if (!program) throw notFound("Program");
  const b = parse(programUpdateSchema, await readJson(c.req.raw));
  if (program.status === "closed") throw conflict("Closed programs cannot be edited.", "program_closed");
  if (b.budgetCents !== undefined) {
    // Prevent invalid budget allocations: the budget can never fall below money already committed.
    const floor = Math.max(program.issuedCents, program.allocatedCents);
    if (b.budgetCents < floor) throw conflict(`Budget cannot be lower than the amount already issued or allocated ($${(floor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}).`, "budget_below_committed");
  }
  if (b.endDate && b.endDate < program.startDate) throw badRequest("End date must be on or after the start date");
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE programs SET name = COALESCE(?, name), description = COALESCE(?, description), end_date = COALESCE(?, end_date), budget_cents = COALESCE(?, budget_cents),
       restrict_home_community = COALESCE(?, restrict_home_community), updated_at = ? WHERE id = ?`,
    ).bind(b.name ?? null, b.description ?? null, b.endDate ?? null, b.budgetCents ?? null, b.restrictHomeCommunity === undefined ? null : b.restrictHomeCommunity ? 1 : 0, now, program.id),
    auditStmt(c.env.DB, user, "program.updated", "program", program.id, program.id, { changes: b }, now),
  ]);
  return c.json({ program: await getProgram(c.env.DB, user.orgId, program.id) });
});

const transitions: Record<string, string[]> = { draft: ["active", "closed"], active: ["paused", "closed"], paused: ["active", "closed"], closed: [] };
programRoutes.post("/:id/status", async (c) => {
  const user = c.get("user");
  const program = await getProgram(c.env.DB, user.orgId, c.req.param("id"));
  if (!program) throw notFound("Program");
  const b = parse(programStatusSchema, await readJson(c.req.raw));
  if (!transitions[program.status].includes(b.status)) throw conflict(`A ${program.status} program cannot move to ${b.status}.`, "invalid_transition");
  const now = c.get("now")().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE programs SET status = ?, updated_at = ? WHERE id = ?").bind(b.status, now, program.id),
    auditStmt(c.env.DB, user, `program.${b.status === "active" ? (program.status === "paused" ? "resumed" : "activated") : b.status}`, "program", program.id, program.id, { from: program.status, to: b.status, reason: b.reason ?? null }, now),
  ]);
  return c.json({ program: await getProgram(c.env.DB, user.orgId, program.id) });
});
