import { Router } from "express";
import { prisma } from "@horizon-scraper/db";
import { normalizeWorldUrl } from "../lib/worldUrl.js";
import { getCCU } from "../scraper/horizon.js";
import { getWorldTitleFromUrl } from "../scraper/worldTitle.js";
import { verifyWorldUrl } from "../scraper/verifyWorld.js";
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

router.get("/summary", async (_req, res) => {
  const worlds = await prisma.world.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      snapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ids = worlds.map((w) => w.id);

  const snaps = await prisma.cCUSnapshot.findMany({
    where: { worldId: { in: ids }, capturedAt: { gte: since } },
    orderBy: [{ worldId: "asc" }, { capturedAt: "asc" }],
  });

  const byWorld: Record<string, CCUSnapshot[]> = {};
  for (const s of snaps) {
    (byWorld[s.worldId] ??= []).push(s);
  }

  function downsample(values: number[], maxPoints: number): number[] {
    if (values.length <= maxPoints) return values;
    const out: number[] = [];
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.floor((i * (values.length - 1)) / (maxPoints - 1));
      out.push(values[idx]!);
    }
    return out;
  }

  const payload = worlds.map((w: World & { snapshots: CCUSnapshot[] }) => {
    const series = byWorld[w.id] ?? [];
    const values = series.map((s) => s.ccu);
    const peak24h = values.length ? Math.max(...values) : null;
    const current24h = values.length ? values[values.length - 1]! : null;
    const first = values.length ? values[0]! : null;
    const change24hPct =
      first == null || first === 0 || current24h == null ? null : ((current24h - first) / first) * 100;
    const spark = downsample(values, 28);

    return {
      id: w.id,
      name: w.name,
      url: w.url,
      isActive: w.isActive,
      createdAt: w.createdAt,
      lastSuccessfulAt: w.lastSuccessfulAt,
      lastError: w.lastError,
      latestCCU: w.snapshots[0]?.ccu ?? null,
      latestCapturedAt: w.snapshots[0]?.capturedAt ?? null,
      stats24h: {
        current: current24h ?? (w.snapshots[0]?.ccu ?? null),
        peak24h,
        change24hPct,
      },
      spark24h: spark,
    };
  });

  res.json(payload);
});

router.post("/", async (req, res) => {
  const rawUrl = String(req.body?.url ?? "");
  const url = normalizeWorldUrl(rawUrl);

  const existing = await prisma.world.findUnique({ where: { url } });
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  const verified = await verifyWorldUrl(url);
  if (!verified.ok) {
    res.status(409).json({ message: `world_not_verifiable:${verified.reason}` });
    return;
  }

  const fallbackName = new URL(url).pathname.split("/").filter(Boolean)[1] ?? "world";
  const scrapedName = await getWorldTitleFromUrl(url);
  const name = scrapedName ?? fallbackName;

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

router.post("/:id/setActive", async (req, res) => {
  const id = String(req.params.id);
  const desired = Boolean(req.body?.isActive);
  const password = String(req.body?.password ?? "");

  const expected = desired ? "STARTTHECOUNT" : "STOPTHECOUNT";
  if (password !== expected) {
    res.status(401).json({ message: "invalid_password" });
    return;
  }

  const updated = await prisma.world.update({
    where: { id },
    data: { isActive: desired },
  });
  res.json(updated);
});

function assertJobSecret(req: any, res: any): boolean {
  const expected = process.env.JOB_SECRET;
  if (!expected) return true;
  const provided = req.header("x-job-secret");
  if (!provided || provided !== expected) {
    res.status(401).json({ message: "unauthorized" });
    return false;
  }
  return true;
}

router.post("/:id/collectNow", async (req, res) => {
  if (!assertJobSecret(req, res)) return;
  const id = String(req.params.id);
  const world = await prisma.world.findUnique({ where: { id } });
  if (!world) {
    res.status(404).json({ message: "world_not_found" });
    return;
  }

  const startedAt = Date.now();
  const result = await Promise.race([
    getCCU(world.url),
    new Promise<ReturnType<typeof getCCU>>((_, reject) =>
      setTimeout(() => reject(new Error("scrape_timeout")), 40_000)
    ),
  ]).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    return { ccu: null, method: "dom" as const, debug: { error: msg } };
  });

  if (result.ccu == null) {
    await prisma.world.update({
      where: { id },
      data: { lastError: `ccu_null (${result.method})` },
    });
    res.status(409).json({ message: "ccu_null", debug: result.debug, elapsedMs: Date.now() - startedAt });
    return;
  }

  const snap = await prisma.cCUSnapshot.create({
    data: { worldId: id, ccu: result.ccu },
  });
  await prisma.world.update({
    where: { id },
    data: { lastSuccessfulAt: new Date(), lastError: null },
  });

  res.json({ ok: true, ccu: result.ccu, capturedAt: snap.capturedAt, method: result.method });
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
  const includePrev =
    typeof req.query.includePrev === "string" &&
    ["1", "true", "yes"].includes(req.query.includePrev.toLowerCase());

  const snapshots = await prisma.cCUSnapshot.findMany({
    where: {
      worldId: id,
      ...(since ? { capturedAt: { gte: since } } : {}),
    },
    orderBy: { capturedAt: "asc" },
  });

  let prev: CCUSnapshot | null = null;
  if (since && includePrev) {
    prev = await prisma.cCUSnapshot.findFirst({
      where: { worldId: id, capturedAt: { lt: since } },
      orderBy: { capturedAt: "desc" },
    });
  }

  const combined = prev ? [prev, ...snapshots] : snapshots;
  res.json(
    combined.map((s: CCUSnapshot) => ({
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

router.post("/:id/refreshTitle", async (req, res) => {
  const id = String(req.params.id);
  const world = await prisma.world.findUnique({ where: { id } });
  if (!world) {
    res.status(404).json({ message: "world_not_found" });
    return;
  }

  const scraped = await getWorldTitleFromUrl(world.url);
  if (!scraped) {
    res.status(409).json({ message: "title_unavailable" });
    return;
  }

  const updated = await prisma.world.update({
    where: { id },
    data: { name: scraped },
  });

  res.json(updated);
});

export default router;

