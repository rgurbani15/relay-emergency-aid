import { all, first, type Row } from "../lib/db";

export const PROGRAM_STATS_SQL = `
  SELECT p.*,
    (SELECT COALESCE(SUM(v.amount_cents),0) FROM vouchers v WHERE v.program_id = p.id AND v.status != 'cancelled') AS issued_cents,
    (SELECT COALESCE(SUM(r.amount_cents),0) FROM redemptions r WHERE r.program_id = p.id AND r.status = 'completed') AS redeemed_cents,
    (SELECT COALESCE(SUM(a.total_recommended_cents),0) FROM allocation_runs a WHERE a.program_id = p.id AND a.status = 'approved') AS allocated_cents,
    (SELECT COALESCE(SUM(c.amount_cents),0) FROM reimbursement_claims c WHERE c.program_id = p.id AND c.status IN ('pending','approved')) AS outstanding_cents,
    (SELECT COUNT(*) FROM program_communities pc WHERE pc.program_id = p.id) AS community_count,
    (SELECT COUNT(*) FROM residents rs WHERE rs.program_id = p.id) AS resident_count
  FROM programs p`;

export function programDto(r: Row) {
  return {
    id: r.id, name: r.name, description: r.description, emergencyType: r.emergency_type, region: r.region, status: r.status,
    budgetCents: r.budget_cents, issuedCents: r.issued_cents, allocatedCents: r.allocated_cents, redeemedCents: r.redeemed_cents, outstandingClaimsCents: r.outstanding_cents,
    startDate: r.start_date, endDate: r.end_date, categories: JSON.parse(r.categories_json ?? "[]") as string[], restrictHomeCommunity: !!r.restrict_home_community,
    communityCount: r.community_count, residentCount: r.resident_count, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function getProgram(db: D1Database, orgId: string, id: string) {
  const r = await first<Row>(db, `${PROGRAM_STATS_SQL} WHERE p.id = ? AND p.org_id = ?`, id, orgId);
  return r ? programDto(r) : null;
}

export async function listProgramsLite(db: D1Database, orgId: string) {
  const rows = await all<Row>(db, `${PROGRAM_STATS_SQL} WHERE p.org_id = ? ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, p.created_at DESC`, orgId);
  return rows.map(programDto);
}

export function stockStatusSql(alias = "i") {
  return `CASE WHEN ${alias}.quantity <= 0 THEN 'out_of_stock' WHEN ${alias}.quantity <= ${alias}.min_threshold * 0.5 THEN 'critical' WHEN ${alias}.quantity <= ${alias}.min_threshold THEN 'low' ELSE 'healthy' END`;
}
