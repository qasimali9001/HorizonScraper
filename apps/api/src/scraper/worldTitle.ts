import { chromium } from "playwright";

export async function getWorldTitleFromUrl(worldUrl: string): Promise<string | null> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    await page.goto(worldUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    const title = await page.title();
    const cleaned = title.trim();
    if (!cleaned) return null;

    // Horizon pages often include site suffix; strip common patterns.
    const withoutSuffix = cleaned
      .replace(/\s*[|\-]\s*Horizon.*$/i, "")
      .replace(/\s*[|\-]\s*Meta.*$/i, "")
      .trim();

    return withoutSuffix || null;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
