import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./playwrightChromium.js";

let attemptedInstall = false;

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function launchCheck(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const browser = await chromium.launch(chromiumLaunchOptions());
    await browser.close();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

/**
 * Ensures Chromium can launch. On Railway/Linux, the browser binary may be present
 * while system libraries (e.g. libglib) are missing — `playwright install-deps` fixes that.
 */
export async function ensurePlaywrightChromiumInstalled(): Promise<void> {
  if (attemptedInstall) return;
  attemptedInstall = true;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const apiRoot = path.resolve(__dirname, "..");

  let r = await launchCheck();
  if (r.ok) return;

  // eslint-disable-next-line no-console
  console.warn(`[playwright] chromium launch check failed: ${r.message}`);

  if (r.message.includes("Executable doesn't exist")) {
    // eslint-disable-next-line no-console
    console.warn("[playwright] installing chromium browser (playwright install chromium)...");
    try {
      await run("npx", ["--yes", "playwright", "install", "chromium"], apiRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[playwright] install chromium failed: ${msg}`);
    }
  }

  r = await launchCheck();
  if (r.ok) {
    // eslint-disable-next-line no-console
    console.log("[playwright] chromium OK");
    return;
  }

  if (process.platform === "linux") {
    // eslint-disable-next-line no-console
    console.warn(
      "[playwright] installing OS libraries for chromium (playwright install-deps chromium)..."
    );
    try {
      await run("npx", ["--yes", "playwright", "install-deps", "chromium"], apiRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[playwright] install-deps failed: ${msg}`);
    }
  }

  r = await launchCheck();
  if (r.ok) {
    // eslint-disable-next-line no-console
    console.log("[playwright] chromium OK (after install-deps)");
    return;
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[playwright] chromium still failing: ${r.message}. Seed/scrape will not work until OS deps are available (see nixpacks.toml or Playwright Docker image).`
  );
}
