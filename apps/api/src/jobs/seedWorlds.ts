import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@horizon-scraper/db";
import { normalizeWorldUrl } from "../lib/worldUrl.js";
import { getWorldTitleFromUrl } from "../scraper/worldTitle.js";

type SeedFile = { worldUrls: string[] };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedWorldsFromFile(): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
}> {
  const seedPath = path.resolve(__dirname, "..", "..", "worlds.seed.json");
  const raw = await fs.readFile(seedPath, "utf8");
  const parsed = JSON.parse(raw) as SeedFile;

  const urls = Array.from(new Set((parsed.worldUrls ?? []).map((u) => normalizeWorldUrl(u))));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const url of urls) {
    const fallbackName = new URL(url).pathname.split("/").filter(Boolean)[1] ?? "world";
    const scrapedName = await getWorldTitleFromUrl(url);
    const name = scrapedName ?? fallbackName;

    const existing = await prisma.world.findUnique({ where: { url } });
    if (!existing) {
      await prisma.world.create({ data: { url, name, isActive: true } });
      inserted++;
      continue;
    }

    if (existing.name !== name) {
      await prisma.world.update({ where: { id: existing.id }, data: { name } });
      updated++;
      continue;
    }

    skipped++;
  }

  return { inserted, updated, skipped };
}

