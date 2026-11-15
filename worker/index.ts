import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Env } from "./env";
import { HttpError } from "./lib/http";
import { requireAuth, requireRole } from "./lib/auth";
import { authRoutes } from "./routes/auth";
import { programRoutes } from "./routes/programs";
import { communityRoutes } from "./routes/communities";
import { residentRoutes } from "./routes/residents";
import { merchantRoutes } from "./routes/merchants";
import { inventoryRoutes } from "./routes/inventory";
import { overviewRoutes } from "./routes/overview";
import { allocationRoutes, intelligenceRoutes } from "./routes/intelligence";
import { financeRoutes } from "./routes/finance";
import { analyze } from "../shared/engine";
import { first } from "./lib/db";
import { loadSnapshot } from "./services/snapshot";
import { merchantPortal, residentPortal } from "./routes/portals";
import { chatRoutes } from "./routes/chat";

export interface AppOptions { now?: () => Date }

export function createApp(opts: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  const clock = opts.now ?? (() => new Date());

  app.use("*", async (c, next) => {
    c.set("now", clock);
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("Cache-Control", "no-store");
  });

  // CSRF defence in depth (alongside SameSite=Lax cookies): mutating requests must carry a custom header
  // (forces a CORS preflight cross-origin) and, when the browser sends Origin, it must match this host.
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      if (c.req.header("x-relay-client") !== "web") throw new HttpError(403, "csrf", "Missing client header");
      const origin = c.req.header("origin");
      if (origin && new URL(origin).host !== new URL(c.req.url).host) throw new HttpError(403, "csrf", "Cross-origin request rejected");
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, demoMode: c.env.DEMO_MODE === "true", time: c.get("now")().toISOString() }));
  app.route("/api/auth", authRoutes);

  // Public, read-only landing preview. Aggregate engine output for the demo program only: no residents, merchants,
  // balances or personal data. Computed by the same shared engine the coordinator console uses.
  app.get("/api/public/preview", async (c) => {
    const p = await first(c.env.DB, "SELECT id, name FROM programs WHERE status != 'closed' ORDER BY (id = 'prog_pine_valley') DESC, created_at ASC LIMIT 1");
    if (!p) return c.json({ program: null, communities: [] });
    const a = analyze(await loadSnapshot(c.env.DB, p.id, c.get("now")()));
    return c.json({
      program: p.name,
      communities: a.communities.map((x) => ({ name: x.name, viability: x.marketViability, voucherPct: x.voucherPct, directPct: x.directPct, action: x.action, actionLabel: x.actionLabel, risk: x.risk, shortageUnits: x.shortageUnits })),
    });
  });

  // Shared + portal routes are registered first; each carries its own auth/role middleware.
  // Inventory is shared: coordinators see everything, merchants only their own stock (enforced inside the routes).
  app.use("/api/inventory/*", requireAuth);
  app.route("/api/inventory", inventoryRoutes);
  app.use("/api/chat", requireAuth);
  app.route("/api/chat", chatRoutes);
  app.use("/api/merchant/*", requireAuth, requireRole("merchant"));
  app.route("/api/merchant", merchantPortal);
  app.use("/api/resident/*", requireAuth, requireRole("resident"));
  app.route("/api/resident", residentPortal);

  // Everything else under /api is coordinator-only.
  const coordinator = new Hono<AppEnv>();
  coordinator.use("*", requireAuth, requireRole("coordinator"));
  coordinator.route("/programs", programRoutes);
  coordinator.route("/communities", communityRoutes);
  coordinator.route("/residents", residentRoutes);
  coordinator.route("/merchants", merchantRoutes);
  coordinator.route("/intelligence", intelligenceRoutes);
  coordinator.route("/allocations", allocationRoutes);
  coordinator.route("/", overviewRoutes);
  coordinator.route("/", financeRoutes);
  app.route("/api", coordinator);

  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Unknown API route" } }, 404));

  app.onError((err, c: Context<AppEnv>) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    console.error("Unhandled error", err);
    return c.json({ error: { code: "internal_error", message: "Something went wrong. Nothing was partially applied." } }, 500);
  });
  return app;
}

const app = createApp();
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
} satisfies ExportedHandler<Env>;
