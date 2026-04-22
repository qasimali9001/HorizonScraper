import { prisma } from "@horizon-scraper/db";
import { getCCU } from "../scraper/horizon.js";

export async function runCCUCollectorOnce(): Promise<void> {
  const worlds = await prisma.world.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  for (const world of worlds) {
    const startedAt = Date.now();
    try {
      const result = await Promise.race([
        getCCU(world.url),
        new Promise<ReturnType<typeof getCCU>>((_, reject) =>
          setTimeout(() => reject(new Error("scrape_timeout")), 40_000)
        ),
      ]);

      if (result.ccu == null) {
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
        data: { lastSuccessfulAt: new Date(), lastError: null },
      });

      // eslint-disable-next-line no-console
      console.log(
        `[ccu] world=${world.id} name="${world.name}" ccu=${result.ccu} method=${result.method} elapsedMs=${Date.now() - startedAt}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.world.update({
        where: { id: world.id },
        data: { lastError: msg },
      });
      // eslint-disable-next-line no-console
      console.error(
        `[ccu] world=${world.id} name="${world.name}" error="${msg}" elapsedMs=${Date.now() - startedAt}`
      );
    }
  }
}

