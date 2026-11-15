import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { SESSION_COOKIE } from "../config";
import { clearSessionCookie, createSession, lookupSession, setSessionCookie } from "../lib/auth";
import { sha256Hex } from "../lib/crypto";
import { all, first, type Row } from "../lib/db";
import { HttpError, forbidden, parse, readJson } from "../lib/http";
import { rateLimited } from "../lib/rateLimit";

export const authRoutes = new Hono<AppEnv>();
const demoOn = (env: AppEnv["Bindings"]) => env.DEMO_MODE === "true";

authRoutes.get("/me", async (c) => {
  const user = await lookupSession(c.env.DB, getCookie(c, SESSION_COOKIE), c.get("now")());
  return c.json({ user, demoMode: demoOn(c.env) });
});

/** Synthetic demo accounts. Available only while DEMO_MODE === "true". */
authRoutes.get("/demo-accounts", async (c) => {
  if (!demoOn(c.env)) throw forbidden("Demo mode is disabled");
  const rows = await all<Row>(
    c.env.DB,
    `SELECT u.id, u.role, u.name, u.merchant_id, u.resident_id, m.name AS merchant_name, cm.name AS merchant_community, rs.status AS resident_status, cr.name AS resident_community
     FROM users u LEFT JOIN merchants m ON m.id = u.merchant_id LEFT JOIN communities cm ON cm.id = m.community_id
     LEFT JOIN residents rs ON rs.id = u.resident_id LEFT JOIN communities cr ON cr.id = rs.community_id
     WHERE u.active = 1 ORDER BY u.role, u.name`,
  );
  return c.json({
    accounts: rows.map((r) => ({
      id: r.id, role: r.role, name: r.name,
      subtitle: r.role === "merchant" ? `${r.merchant_name} · ${r.merchant_community}` : r.role === "resident" ? `${r.resident_community}${r.resident_status === "suspended" ? " · suspended" : ""}` : "Relief operations lead",
    })),
  });
});

const demoSchema = z.object({ role: z.enum(["coordinator", "merchant", "resident"]), userId: z.string().optional() });

authRoutes.post("/demo", async (c) => {
  if (!demoOn(c.env)) throw forbidden("Demo sign-in is disabled in this environment");
  if (rateLimited(`demo:${c.req.header("cf-connecting-ip") ?? "local"}`, 30, 60_000, c.get("now")().getTime())) throw new HttpError(429, "rate_limited", "Too many sign-in attempts. Try again shortly.");
  const body = parse(demoSchema, await readJson(c.req.raw));
  // The requested role only selects WHICH synthetic account to sign in as; the session role comes from that user's database row.
  const user = body.userId
    ? await first<Row>(c.env.DB, "SELECT id, role FROM users WHERE id = ? AND role = ? AND active = 1", body.userId, body.role)
    : await first<Row>(c.env.DB, "SELECT id, role FROM users WHERE role = ? AND active = 1 ORDER BY CASE id WHEN 'usr_coordinator' THEN 0 WHEN 'usr_mer_1004' THEN 0 WHEN 'usr_res_1005' THEN 0 ELSE 1 END, id LIMIT 1", body.role);
  if (!user) throw new HttpError(404, "not_found", "Demo account not found");
  const now = c.get("now")();
  const { token, expires } = await createSession(c.env.DB, user.id, now);
  setSessionCookie(c, token, expires);
  const session = await lookupSession(c.env.DB, token, now);
  return c.json({ user: session });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});
