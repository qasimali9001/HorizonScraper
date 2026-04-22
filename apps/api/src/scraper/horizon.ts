import { chromium } from "playwright";
import { discoverCCURequestsOnPage } from "./discovery.js";
import { extractCCUFromText } from "./domExtract.js";

export type CCUMethod = "api" | "graphql" | "dom";

export type GetCCUResult = {
  ccu: number | null;
  method: CCUMethod;
  debug?: Record<string, unknown>;
};

function looksLikeGraphQL(candidateUrl: string): boolean {
  const u = candidateUrl.toLowerCase();
  return u.includes("/graphql") || u.includes("graph") || u.includes("gql");
}

function normalizeWorldUrl(url: string): string {
  // Ensure trailing slash for consistency.
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  const s = u.toString();
  return s.endsWith("/") ? s : `${s}/`;
}

export async function getCCU(url: string): Promise<GetCCUResult> {
  const worldUrl = normalizeWorldUrl(url);
  const startedAt = Date.now();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    await page.goto(worldUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // 1) Try to discover internal XHR/fetch calls that expose CCU directly.
    const discovered = await discoverCCURequestsOnPage(page, {
      timeoutMs: 25_000,
      maxCandidates: 12,
    });

    const hit = discovered.find((c) => typeof c.detectedCCU === "number");
    if (hit?.detectedCCU != null) {
      return {
        ccu: hit.detectedCCU,
        method: looksLikeGraphQL(hit.url) ? "graphql" : "api",
        debug: {
          discovery: {
            url: hit.url,
            method: hit.method,
            status: hit.status,
            detectedPath: hit.detectedPath,
          },
          elapsedMs: Date.now() - startedAt,
        },
      };
    }

    // 2) Fallback: read visible text and regex-extract CCU.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const bodyText = await page.evaluate(() => {
      const doc = globalThis as unknown as { document?: { body?: { innerText?: string } } };
      return doc.document?.body?.innerText ?? "";
    });
    const extracted = extractCCUFromText(bodyText);
    if (extracted.ok) {
      return {
        ccu: extracted.ccu,
        method: "dom",
        debug: { rawMatch: extracted.rawMatch, elapsedMs: Date.now() - startedAt },
      };
    }

    return {
      ccu: null,
      method: "dom",
      debug: {
        reason: extracted.reason,
        discoveredCount: discovered.length,
        sampleDiscovered: discovered.slice(0, 3).map((c) => ({
          url: c.url,
          status: c.status,
          detectedCCU: c.detectedCCU,
          detectedPath: c.detectedPath,
        })),
        elapsedMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    return {
      ccu: null,
      method: "dom",
      debug: {
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt,
      },
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

