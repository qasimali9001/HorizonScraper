import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { prisma } from "@horizon-scraper/db";
import { chromiumLaunchOptions } from "../playwrightChromium.js";
import { getWorldTitleWithPage } from "../scraper/worldTitle.js";

export type RefreshWorldNameRow = {
  id: string;
  url: string;
  previousName: string;
  name: string;
  status: "updated" | "skipped" | "failed";
  error?: string;
};

export type RefreshAllWorldNamesResult = {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  worlds: RefreshWorldNameRow[];
};

async function withTitleBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    browser = await chromium.launch(chromiumLaunchOptions());
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    page = await context.newPage();
    return await fn(page);
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export async function refreshAllWorldNames(): Promise<RefreshAllWorldNamesResult> {
  const worlds = await prisma.world.findMany({ orderBy: { createdAt: "asc" } });
  const result: RefreshAllWorldNamesResult = {
    total: worlds.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    worlds: [],
  };

  await withTitleBrowser(async (page) => {
    for (const w of worlds) {
      const previousName = w.name;
      try {
        const title = await getWorldTitleWithPage(page, w.url);
        if (!title) {
          result.skipped++;
          result.worlds.push({
            id: w.id,
            url: w.url,
            previousName,
            name: previousName,
            status: "skipped",
          });
          continue;
        }
        await prisma.world.update({ where: { id: w.id }, data: { name: title } });
        result.updated++;
        result.worlds.push({
          id: w.id,
          url: w.url,
          previousName,
          name: title,
          status: "updated",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.failed++;
        result.worlds.push({
          id: w.id,
          url: w.url,
          previousName,
          name: previousName,
          status: "failed",
          error: msg,
        });
      }
    }
  });

  return result;
}
