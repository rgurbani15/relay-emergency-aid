export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS?: Fetcher;
  /** "true" enables the synthetic demo sign-in endpoint. Anything else disables it. */
  DEMO_MODE?: string;
  /** Workers AI model id for the Scenario Interpreter (see worker/config.ts). */
  AI_MODEL?: string;
  /** Optional separate Workers AI model id for the chat assistant (falls back to AI_MODEL, then the default Llama). */
  AI_MODEL_CHAT?: string;
  /** HMAC key for voucher QR credentials. Set with `wrangler secret put` (prod) or .dev.vars (local). */
  VOUCHER_SIGNING_SECRET?: string;
}

export interface SessionUser {
  id: string;
  orgId: string;
  role: "coordinator" | "merchant" | "resident";
  name: string;
  email: string;
  merchantId: string | null;
  residentId: string | null;
}

export type AppVariables = { user: SessionUser; now: () => Date };
export type AppEnv = { Bindings: Env; Variables: AppVariables };
