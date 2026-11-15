import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

const r = (p: string) => path.resolve(process.cwd(), p);

// `npm run dev` uses wrangler.dev.jsonc (no Workers AI binding) so local development works without a
// Cloudflare login. `npm run dev:ai` (RELAY_AI=1) uses wrangler.jsonc, whose AI binding talks to your
// Cloudflare account. Builds/deploys always use wrangler.jsonc.
export default defineConfig(({ command, isPreview }) => {
  const localNoAi = command === "serve" && !isPreview && process.env.RELAY_AI !== "1";
  return {
    plugins: [
      react(),
      tailwindcss(),
      cloudflare({ viteEnvironment: { name: "worker" }, ...(localNoAi ? { configPath: "./wrangler.dev.jsonc" } : {}) }),
    ],
    resolve: { alias: { "@shared": r("./shared"), "@": r("./src") } },
    environments: { worker: { build: { sourcemap: true } } },
    build: { chunkSizeWarningLimit: 900 },
  };
});
