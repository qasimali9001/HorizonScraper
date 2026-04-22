import "dotenv/config";
import cors from "cors";
import express from "express";
import cron from "node-cron";
import { runCCUCollectorOnce } from "./jobs/ccuCollector.js";
import { seedWorldsFromFile } from "./jobs/seedWorlds.js";
import worldsRouter from "./routes/worlds.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/worlds", worldsRouter);

app.post("/jobs/ccuCollector/runOnce", async (req, res) => {
  const expected = process.env.JOB_SECRET;
  if (expected) {
    const provided = req.header("x-job-secret");
    if (!provided || provided !== expected) {
      res.status(401).json({ message: "unauthorized" });
      return;
    }
  }
  await runCCUCollectorOnce();
  res.json({ ok: true });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown_error";
  res.status(400).json({ message });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});

const seedWorlds = (process.env.SEED_WORLDS ?? "false").toLowerCase() === "true";
if (seedWorlds) {
  seedWorldsFromFile()
    .then(({ inserted, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(`[seed] worlds.seed.json inserted=${inserted} skipped=${skipped}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[seed] failed: ${err instanceof Error ? err.message : String(err)}`
      );
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

