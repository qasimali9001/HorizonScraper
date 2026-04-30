import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../playwrightChromium.js";
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

  async function launchWithRetry(): Promise<import("playwright").Browser> {
    const base = chromiumLaunchOptions();
    const linuxExtra =
      process.platform === "linux"
        ? {
            args: [
              ...(base.args ?? []),
              "--no-zygote",
              "--single-process",
              "--disable-features=site-per-process",
            ],
          }
        : {};
    const attempt = async (opts: any) => chromium.launch(opts);
    try {
      return await attempt(base as any);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Common Railway failure mode: chromium process dies immediately.
      if (
        msg.includes("Target page, context or browser has been closed") ||
        msg.includes("SIGTRAP") ||
        msg.toLowerCase().includes("browser has been closed")
      ) {
        // eslint-disable-next-line no-console
        console.warn(`[ccu] chromium launch failed, retrying with extra flags: ${msg}`);
        return await attempt({ ...base, ...(linuxExtra as any) });
      }
      throw err;
    }
  }

  let browser: import("playwright").Browser | null = null;
  let context: import("playwright").BrowserContext | null = null;
  let page: import("playwright").Page | null = null;

  try {
    browser = await launchWithRetry();
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    page = await context.newPage();

    const resp = await page.goto(worldUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const status = resp?.status() ?? 0;
    if (status === 403 || status === 429) {
      return {
        ccu: null,
        method: "dom",
        debug: {
          blocked: true,
          blockedReason: `http_${status}`,
          elapsedMs: Date.now() - startedAt,
        },
      };
    }

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
    const low = bodyText.toLowerCase();
    if (
      low.includes("too many requests") ||
      low.includes("temporarily blocked") ||
      low.includes("try again later") ||
      low.includes("rate limit")
    ) {
      return {
        ccu: null,
        method: "dom",
        debug: {
          blocked: true,
          blockedReason: "block_page_text",
          elapsedMs: Date.now() - startedAt,
        },
      };
    }
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
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

