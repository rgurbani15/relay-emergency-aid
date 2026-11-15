import { createApp } from "../../worker/index";
import { buildSeed } from "../../scripts/seed-data";
import { createTestDb, type SqliteD1 } from "./sqlite-d1";
import { resetRateLimits } from "../../worker/lib/rateLimit";

export const NOW = "2026-11-12T16:00:00.000Z";

export interface TestCtx {
  db: SqliteD1;
  env: Record<string, unknown>;
  clock: { now: Date };
  call: (method: string, path: string, opts?: { body?: unknown; cookie?: string; headers?: Record<string, string> }) => Promise<{ status: number; json: any; headers: Headers; text: string }>;
  login: (role: "coordinator" | "merchant" | "resident", userId?: string) => Promise<string>;
}

export function setup(over: { env?: Record<string, unknown>; ai?: unknown } = {}): TestCtx {
  resetRateLimits();
  const seed = buildSeed(NOW);
  const db = createTestDb(seed.sql);
  const clock = { now: new Date(NOW) };
  const app = createApp({ now: () => clock.now });
  const env: Record<string, unknown> = { DB: db, DEMO_MODE: "true", VOUCHER_SIGNING_SECRET: "test-secret-0123456789", AI: over.ai, AI_MODEL: "@cf/test/model", ...over.env };
  const call: TestCtx["call"] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (method !== "GET") { headers["x-relay-client"] ??= "web"; headers["content-type"] = "application/json"; }
    if (opts.cookie) headers.cookie = opts.cookie;
    const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env as never);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers, text };
  };
  const login: TestCtx["login"] = async (role, userId) => {
    const res = await call("POST", "/api/auth/demo", { body: { role, userId } });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${res.text}`);
    return (res.headers.get("set-cookie") ?? "").split(";")[0];
  };
  return { db, env, clock, call, login };
}
