/** Minimal D1Database-compatible adapter over better-sqlite3, for tests.
 * Mirrors D1 semantics that matter here: parameterized prepared statements, and `batch()` being atomic
 * (all statements succeed or none are applied). */
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

class Stmt {
  constructor(private db: Database.Database, readonly sql: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Stmt(this.db, this.sql, params); }
  private prep() { return this.db.prepare(this.sql); }
  async first<T = unknown>(col?: string): Promise<T | null> {
    const row = this.prep().get(...(this.params as never[])) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
  async all<T = unknown>() {
    const rows = this.prep().all(...(this.params as never[])) as T[];
    return { results: rows, success: true, meta: {} };
  }
  async run() {
    const info = this.prep().run(...(this.params as never[]));
    return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) }, results: [] };
  }
  /** used by batch */
  execSync() {
    const p = this.prep();
    if (p.reader) return { results: p.all(...(this.params as never[])), success: true, meta: {} };
    const info = p.run(...(this.params as never[]));
    return { results: [], success: true, meta: { changes: info.changes } };
  }
}

export class SqliteD1 {
  readonly raw: Database.Database;
  constructor(file = ":memory:") {
    this.raw = new Database(file);
    this.raw.pragma("foreign_keys = ON");
  }
  prepare(sql: string) { return new Stmt(this.raw, sql); }
  async exec(sql: string) { this.raw.exec(sql); return { count: 1, duration: 0 }; }
  async batch(stmts: Stmt[]) {
    const tx = this.raw.transaction(() =>
      stmts.map((s) => {
        try { return s.execSync(); } catch (e) { (e as Error).message += ` [in: ${s.sql.replace(/\s+/g, " ").slice(0, 90)}]`; throw e; }
      }),
    );
    return tx();
  }
}

export function createTestDb(seedSql?: string): SqliteD1 {
  const db = new SqliteD1();
  const dir = join(process.cwd(), "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.raw.exec(readFileSync(join(dir, f), "utf8"));
  if (seedSql) db.raw.exec(seedSql);
  return db;
}
