import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@horizon-scraper/db";
import { normalizeWorldUrl } from "../lib/worldUrl.js";

type SeedFile = { worldUrls: string[] };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedWorldsFromFile(): Promise<{ inserted: number; skipped: number }> {
  const seedPath = path.resolve(__dirname, "..", "..", "worlds.seed.json");
  const raw = await fs.readFile(seedPath, "utf8");
  const parsed = JSON.parse(raw) as SeedFile;

  const urls = Array.from(new Set((parsed.worldUrls ?? []).map((u) => normalizeWorldUrl(u))));
  let inserted = 0;
  let skipped = 0;

  for (const url of urls) {
    const name = new URL(url).pathname.split("/").filter(Boolean)[1] ?? "world";
    const existing = await prisma.world.findUnique({ where: { url } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.world.create({ data: { url, name, isActive: true } });
    inserted++;
  }

  return { inserted, skipped };
}

