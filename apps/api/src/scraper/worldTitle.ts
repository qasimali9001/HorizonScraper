import type { Page } from "playwright";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../playwrightChromium.js";

export function cleanHorizonPageTitle(raw: string): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const withoutSuffix = cleaned
    .replace(/\s*[|\-]\s*Horizon.*$/i, "")
    .replace(/\s*[|\-]\s*Meta.*$/i, "")
    .trim();

  return withoutSuffix || null;
}

/** Navigate with an existing page (reuse one browser for bulk refresh). */
export async function getWorldTitleWithPage(page: Page, worldUrl: string): Promise<string | null> {
  try {
    await page.goto(worldUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const title = await page.title();
    return cleanHorizonPageTitle(title);
  } catch {
    return null;
  }
}

export async function getWorldTitleFromUrl(worldUrl: string): Promise<string | null> {
  const browser = await chromium.launch(chromiumLaunchOptions());
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    return await getWorldTitleWithPage(page, worldUrl);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
