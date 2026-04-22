import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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

export async function ensurePlaywrightChromiumInstalled(): Promise<void> {
  if (attemptedInstall) return;
  attemptedInstall = true;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const apiRoot = path.resolve(__dirname, "..");

  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const looksMissingExecutable =
      msg.includes("Executable doesn't exist") || msg.includes("BrowserType.launch");

    if (!looksMissingExecutable) {
      // eslint-disable-next-line no-console
      console.warn(`[playwright] chromium launch check failed: ${msg}`);
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.warn("[playwright] chromium missing; attempting one-time install (npx playwright install chromium)");

  try {
    await run("npx", ["--yes", "playwright", "install", "chromium"], apiRoot);

    const browser = await chromium.launch({ headless: true });
    await browser.close();

    // eslint-disable-next-line no-console
    console.log("[playwright] chromium install OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[playwright] chromium install failed: ${msg}. CCU scraping may not work until browsers/deps are installed on the host.`
    );
  }
}
