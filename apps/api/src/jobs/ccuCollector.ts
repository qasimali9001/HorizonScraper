import { prisma } from "@horizon-scraper/db";
import { getCCU } from "../scraper/horizon.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockedResult(result: Awaited<ReturnType<typeof getCCU>>): boolean {
  const b = (result.debug as any)?.blocked;
  if (b === true) return true;
  const err = (result.debug as any)?.error;
  const msg = typeof err === "string" ? err : "";
  return (
    msg.includes("429") ||
    msg.includes("403") ||
    msg.toLowerCase().includes("too many requests") ||
    msg.toLowerCase().includes("temporarily blocked")
  );
}

function computeCooldownMs(blockedCount: number): number {
  const baseMs = Math.max(1, Number(process.env.BLOCKED_BACKOFF_BASE_MINUTES ?? 30)) * 60 * 1000;
  const exp = Math.min(6, Math.max(0, blockedCount - 1)); // cap exponential growth
  const ms = baseMs * Math.pow(2, exp);
  const maxMs = 24 * 60 * 60 * 1000;
  return Math.min(maxMs, ms);
}

export async function runCCUCollectorOnce(): Promise<void> {
  const run = await prisma.collectorRun.create({
    data: {
      status: "running",
    },
  });

  const now = new Date();
  const worlds = await prisma.world.findMany({
    where: {
      isActive: true,
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
  const skipped = await prisma.world.count({
    where: { isActive: true, cooldownUntil: { gte: now } },
  });

  await prisma.collectorRun.update({
    where: { id: run.id },
    data: { worldsTotal: worlds.length + skipped, worldsSkipped: skipped },
  });

  const delayMs = Math.max(0, Number(process.env.COLLECTOR_WORLD_DELAY_MS ?? 15_000));
  const maxConsecutiveBlocked = Math.max(
    1,
    Number(process.env.BLOCKED_GLOBAL_STOP_AFTER ?? 3)
  );
  let consecutiveBlocked = 0;
  let processed = 0;
  let blocked = 0;
  let errors = 0;

  for (let i = 0; i < worlds.length; i++) {
    const world = worlds[i]!;
    const startedAt = Date.now();
    try {
      const result = await Promise.race([
        getCCU(world.url),
        new Promise<ReturnType<typeof getCCU>>((_, reject) =>
          setTimeout(() => reject(new Error("scrape_timeout")), 40_000)
        ),
      ]);

      processed++;

      if (isBlockedResult(result)) {
        blocked++;
        consecutiveBlocked++;
        const nextBlockedCount = (world.blockedCount ?? 0) + 1;
        const cooldownMs = computeCooldownMs(nextBlockedCount);
        const cooldownUntil = new Date(Date.now() + cooldownMs);
        await prisma.world.update({
          where: { id: world.id },
          data: {
            blockedCount: nextBlockedCount,
            cooldownUntil,
            lastError: `blocked (cooldown ${Math.round(cooldownMs / 60000)}m)`,
          },
        });
        // eslint-disable-next-line no-console
        console.warn(
          `[ccu] world=${world.id} name="${world.name}" blocked=true cooldownUntil=${cooldownUntil.toISOString()}`
        );

        if (consecutiveBlocked >= maxConsecutiveBlocked) {
          // eslint-disable-next-line no-console
          console.warn(
            `[ccu] stopping run early after ${consecutiveBlocked} consecutive blocked worlds`
          );
          await prisma.collectorRun.update({
            where: { id: run.id },
            data: {
              status: "stopped",
              finishedAt: new Date(),
              worldsProcessed: processed,
              blockedCount: blocked,
              errorCount: errors,
              notes: `stopped_after_${consecutiveBlocked}_blocked`,
            },
          });
          return;
        }
        continue;
      } else {
        consecutiveBlocked = 0;
      }

      if (result.ccu == null) {
        errors++;
        await prisma.world.update({
          where: { id: world.id },
          data: {
            lastError: `ccu_null (${result.method})`,
          },
        });
        // eslint-disable-next-line no-console
        console.warn(
          `[ccu] world=${world.id} name="${world.name}" ccu=null method=${result.method} elapsedMs=${Date.now() - startedAt}`
        );
        if (result.debug) {
          // eslint-disable-next-line no-console
          console.warn(`[ccu] debug=${JSON.stringify(result.debug)}`);
        }
        continue;
      }

      await prisma.cCUSnapshot.create({
        data: { worldId: world.id, ccu: result.ccu },
      });

      await prisma.world.update({
        where: { id: world.id },
        data: {
          lastSuccessfulAt: new Date(),
          lastError: null,
          blockedCount: 0,
          cooldownUntil: null,
        },
      });

      // eslint-disable-next-line no-console
      console.log(
        `[ccu] world=${world.id} name="${world.name}" ccu=${result.ccu} method=${result.method} elapsedMs=${Date.now() - startedAt}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors++;
      await prisma.world.update({
        where: { id: world.id },
        data: { lastError: msg },
      });
      // eslint-disable-next-line no-console
      console.error(
        `[ccu] world=${world.id} name="${world.name}" error="${msg}" elapsedMs=${Date.now() - startedAt}`
      );
    } finally {
      // Throttle between worlds to reduce rate limiting / temporary blocks.
      if (i < worlds.length - 1 && delayMs > 0) {
        // eslint-disable-next-line no-console
        console.log(`[ccu] sleeping ${delayMs}ms before next world`);
        await sleep(delayMs);
      }
    }
  }

  await prisma.collectorRun.update({
    where: { id: run.id },
    data: {
      status: "ok",
      finishedAt: new Date(),
      worldsProcessed: processed,
      blockedCount: blocked,
      errorCount: errors,
    },
  });
}

