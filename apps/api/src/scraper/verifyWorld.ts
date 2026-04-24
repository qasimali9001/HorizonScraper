import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../playwrightChromium.js";

export type VerifyWorldResult =
  | { ok: true; finalUrl: string }
  | { ok: false; reason: "not_found" | "blocked" | "unexpected"; detail?: string };

/**
 * Lightweight verification that a Horizon world link is real.
 * We just need to ensure the page exists (not 404 / "not found") without auth.
 */
export async function verifyWorldUrl(worldUrl: string): Promise<VerifyWorldResult> {
  const browser = await chromium.launch(chromiumLaunchOptions());
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  try {
    const resp = await page.goto(worldUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const status = resp?.status() ?? 0;
    // Some environments return null response object on navigation; treat as unexpected.
    if (!status) {
      return { ok: false, reason: "unexpected", detail: "no_response" };
    }

    if (status === 404) return { ok: false, reason: "not_found" };
    if (status >= 400) return { ok: false, reason: "blocked", detail: `status_${status}` };

    const text = (
      await page.evaluate(() => {
        const g = globalThis as unknown as { document?: { body?: { innerText?: string } } };
        return g.document?.body?.innerText ?? "";
      })
    ).toLowerCase();
    if (text.includes("world not found") || text.includes("page not found")) {
      return { ok: false, reason: "not_found" };
    }

    // If we can see "Sign in to visit" it's still a real world page.
    return { ok: true, finalUrl: page.url() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "unexpected", detail: msg };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

