import { Router } from "express";
import { prisma } from "@horizon-scraper/db";
import { normalizeWorldUrl } from "../lib/worldUrl.js";
import { getCCU } from "../scraper/horizon.js";
import type { World, CCUSnapshot } from "@prisma/client";

const router = Router();

router.get("/", async (_req, res) => {
  const worlds = await prisma.world.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      snapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  res.json(
    worlds.map((w: World & { snapshots: CCUSnapshot[] }) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      isActive: w.isActive,
      createdAt: w.createdAt,
      lastSuccessfulAt: w.lastSuccessfulAt,
      lastError: w.lastError,
      latestCCU: w.snapshots[0]?.ccu ?? null,
      latestCapturedAt: w.snapshots[0]?.capturedAt ?? null,
    }))
  );
});

router.post("/", async (req, res) => {
  const rawUrl = String(req.body?.url ?? "");
  const url = normalizeWorldUrl(rawUrl);

  // V1: name defaults to world id slug; can improve later by scraping title.
  const name = new URL(url).pathname.split("/").filter(Boolean)[1] ?? "world";

  const created = await prisma.world.create({
    data: { url, name, isActive: true },
  });

  res.status(201).json(created);
});

router.delete("/:id", async (req, res) => {
  const id = String(req.params.id);
  await prisma.world.delete({ where: { id } });
  res.json({ ok: true });
});

function rangeToSince(range: string | undefined): Date | null {
  const now = Date.now();
  switch ((range ?? "24h").toLowerCase()) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
    default:
      throw new Error("invalid_range");
  }
}

router.get("/:id/ccu", async (req, res) => {
  const id = String(req.params.id);
  const since = rangeToSince(
    typeof req.query.range === "string" ? req.query.range : undefined
  );

  const snapshots = await prisma.cCUSnapshot.findMany({
    where: {
      worldId: id,
      ...(since ? { capturedAt: { gte: since } } : {}),
    },
    orderBy: { capturedAt: "asc" },
  });

  res.json(
    snapshots.map((s: CCUSnapshot) => ({
      ccu: s.ccu,
      capturedAt: s.capturedAt,
    }))
  );
});

router.get("/:id/latest", async (req, res) => {
  const id = String(req.params.id);
  const latest = await prisma.cCUSnapshot.findFirst({
    where: { worldId: id },
    orderBy: { capturedAt: "desc" },
  });
  res.json({
    ccu: latest?.ccu ?? null,
    capturedAt: latest?.capturedAt ?? null,
  });
});

router.post("/:id/scrapeTest", async (req, res) => {
  const id = String(req.params.id);
  const world = await prisma.world.findUnique({ where: { id } });
  if (!world) {
    res.status(404).json({ message: "world_not_found" });
    return;
  }

  const result = await getCCU(world.url);
  res.json(result);
});

export default router;

