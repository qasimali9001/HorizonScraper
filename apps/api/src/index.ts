import "dotenv/config";
import cors from "cors";
import express from "express";
import cron from "node-cron";
import { runCCUCollectorOnce } from "./jobs/ccuCollector.js";
import { refreshAllWorldNames } from "./jobs/refreshWorldNames.js";
import { seedWorldsFromFile } from "./jobs/seedWorlds.js";
import { ensurePlaywrightChromiumInstalled } from "./playwrightBootstrap.js";
import worldsRouter from "./routes/worlds.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/worlds", worldsRouter);

function assertJobSecret(req: express.Request, res: express.Response): boolean {
  const expected = process.env.JOB_SECRET;
  if (!expected) return true;
  const provided = req.header("x-job-secret");
  if (!provided || provided !== expected) {
    res.status(401).json({ message: "unauthorized" });
    return false;
  }
  return true;
}

let ccuCollectorRunning = false;
let ccuCollectorLastStartedAt: Date | null = null;
let ccuCollectorLastFinishedAt: Date | null = null;

app.post("/jobs/ccuCollector/runOnce", async (req, res) => {
  if (!assertJobSecret(req, res)) return;

  if (ccuCollectorRunning) {
    res.status(409).json({
      ok: false,
      message: "collector_already_running",
      lastStartedAt: ccuCollectorLastStartedAt,
    });
    return;
  }

  // Return immediately to avoid gateway timeouts (Railway 502).
  ccuCollectorRunning = true;
  ccuCollectorLastStartedAt = new Date();
  res.status(202).json({
    ok: true,
    accepted: true,
    startedAt: ccuCollectorLastStartedAt,
    lastFinishedAt: ccuCollectorLastFinishedAt,
  });

  void runCCUCollectorOnce()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(
        `[ccu] runOnce failed: ${err instanceof Error ? err.message : String(err)}`
      );
    })
    .finally(() => {
      ccuCollectorLastFinishedAt = new Date();
      ccuCollectorRunning = false;
    });
});

app.post("/jobs/worldNames/refreshAll", async (req, res) => {
  if (!assertJobSecret(req, res)) return;
  const summary = await refreshAllWorldNames();
  res.json({ ok: true, ...summary });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown_error";
  res.status(400).json({ message });
});

const port = Number(process.env.PORT ?? 3001);

void (async () => {
  await ensurePlaywrightChromiumInstalled();

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
  });

  const seedWorlds = (process.env.SEED_WORLDS ?? "false").toLowerCase() === "true";
  if (seedWorlds) {
    seedWorldsFromFile()
      .then(({ inserted, updated, skipped }) => {
        // eslint-disable-next-line no-console
        console.log(
          `[seed] worlds.seed.json inserted=${inserted} updated=${updated} skipped=${skipped}`
        );
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[seed] failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  const cronEnabled = (process.env.CRON_ENABLED ?? "true").toLowerCase() === "true";
  const schedule = process.env.CRON_SCHEDULE ?? "*/30 * * * *";
  if (cronEnabled) {
    cron.schedule(schedule, async () => {
      await runCCUCollectorOnce();
    });
    // eslint-disable-next-line no-console
    console.log(`[cron] enabled schedule="${schedule}"`);
  }
})();

