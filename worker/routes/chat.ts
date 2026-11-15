import { Hono } from "hono";
import type { AppEnv } from "../env";
import { chatSchema } from "../../shared/schemas";
import { HttpError, parse, readJson } from "../lib/http";
import { rateLimited } from "../lib/rateLimit";
import { chatReply } from "../services/chat";

export const chatRoutes = new Hono<AppEnv>();

/** Read-only assistant for every role. Nothing is stored and the model can never write records. */
chatRoutes.post("/", async (c) => {
  const user = c.get("user");
  const now = c.get("now")();
  if (rateLimited(`chat:${user.id}`, 20, 60_000, now.getTime())) throw new HttpError(429, "rate_limited", "Too many questions. Wait a moment and try again.");
  const b = parse(chatSchema, await readJson(c.req.raw));
  return c.json(await chatReply(c.env, user, b.message, b.history, now, user.role === "coordinator" ? b.programId : undefined));
});
