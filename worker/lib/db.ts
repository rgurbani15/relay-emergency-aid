import type { SessionUser } from "../env";
import { shortId } from "./crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export async function all<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}
export async function first<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}
export async function scalar<T = number>(db: D1Database, sql: string, ...params: unknown[]): Promise<T> {
  const r = await db.prepare(sql).bind(...params).first<Row>();
  return (r ? Object.values(r)[0] : 0) as T;
}

/** Build an audit-log INSERT to be batched atomically with the mutation it describes. */
export function auditStmt(
  db: D1Database,
  user: Pick<SessionUser, "id" | "orgId" | "name" | "role">,
  action: string,
  entityType: string,
  entityId: string | null,
  programId: string | null,
  metadata: Record<string, unknown>,
  nowIso: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_logs (id, org_id, actor_user_id, actor_name, actor_role, action, entity_type, entity_id, program_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(shortId("aud"), user.orgId, user.id, user.name, user.role, action, entityType, entityId, programId, JSON.stringify(metadata), nowIso);
}

export interface Page { page: number; pageSize: number; offset: number }
export function pageOf(q: Record<string, string | undefined>, defSize = 10): Page {
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? String(defSize), 10) || defSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const likeTerm = (s: string) => `%${s.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
