import { defineConfig } from "vitest/config";

// Tests run the Hono app directly against an in-memory SQLite database that mimics D1,
// so they need no Cloudflare credentials and no Vite/Cloudflare plugin.
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});
