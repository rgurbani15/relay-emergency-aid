import { writeFileSync, mkdirSync } from "node:fs";
import { buildSeed } from "./seed-data";

// SEED_ANCHOR=2026-11-12 pins the "current time" of the seed; default is the actual current time.
const anchor = process.env.SEED_ANCHOR ? new Date(`${process.env.SEED_ANCHOR}T16:00:00.000Z`).toISOString() : new Date().toISOString();
const seed = buildSeed(anchor);
mkdirSync("seed", { recursive: true });
writeFileSync("seed/seed.sql", seed.sql);
const counts = Object.entries(seed.tables).map(([k, v]) => `${k}=${v.length}`).join(" ");
console.log(`Wrote seed/seed.sql (anchor ${anchor})\n${counts}`);
