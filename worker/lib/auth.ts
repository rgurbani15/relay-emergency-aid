import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "../env";
import { SESSION_COOKIE, SESSION_TTL_HOURS } from "../config";
import { randomToken, sha256Hex } from "./crypto";
import { first } from "./db";
import { HttpError, forbidden } from "./http";

export async function createSession(db: D1Database, userId: string, now: Date): Promise<{ token: string; expires: Date }> {
  const token = randomToken(32);
  const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3_600_000);
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now.toISOString(), expires.toISOString())
    .run();
  return { token, expires };
}

export function setSessionCookie(c: Parameters<MiddlewareHandler<AppEnv>>[0], token: string, expires: Date) {
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", expires });
}
export function clearSessionCookie(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function lookupSession(db: D1Database, token: string | undefined, now: Date): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await first<{ id: string; org_id: string; role: SessionUser["role"]; name: string; email: string; merchant_id: string | null; resident_id: string | null }>(
    db,
    `SELECT u.id, u.org_id, u.role, u.name, u.email, u.merchant_id, u.resident_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    await sha256Hex(token),
    now.toISOString(),
  );
  return row ? { id: row.id, orgId: row.org_id, role: row.role, name: row.name, email: row.email, merchantId: row.merchant_id, residentId: row.resident_id } : null;
}

/** Authenticate from the HttpOnly session cookie. The role always comes from the database, never from the client. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await lookupSession(c.env.DB, getCookie(c, SESSION_COOKIE), c.get("now")());
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in to continue");
  c.set("user", user);
  await next();
};

export const requireRole = (...roles: SessionUser["role"][]): MiddlewareHandler<AppEnv> => async (c, next) => {
  const user = c.get("user");
  if (!roles.includes(user.role)) throw forbidden("Your role cannot access this resource");
  await next();
};
