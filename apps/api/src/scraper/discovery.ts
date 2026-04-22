import type { Page, Request, Response } from "playwright";

export type DiscoveryCandidate = {
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestPostData?: string;
  responseHeaders: Record<string, string>;
  responseSnippet: string;
  detectedCCU?: number;
  detectedPath?: string;
};

function tryFindNumberLikeCCU(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // only accept pure numeric strings (avoid parsing IDs)
    if (!/^\d{1,7}$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }
  return null;
}

function looksLikeCCUKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "ccu" ||
    k.includes("concurrent") ||
    k.includes("concurrentusers") ||
    k.includes("currentconcurrent") ||
    k.includes("activeusers") ||
    k.includes("active_players") ||
    k.includes("players_online")
  );
}

function searchJsonForCCU(
  node: unknown,
  path: string[] = []
): { ccu: number; jsonPath: string } | null {
  if (node && typeof node === "object") {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = searchJsonForCCU(node[i], [...path, String(i)]);
        if (found) return found;
      }
      return null;
    }

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = [...path, k];
      if (looksLikeCCUKey(k)) {
        const maybe = tryFindNumberLikeCCU(v);
        if (maybe != null) return { ccu: maybe, jsonPath: p.join(".") };
      }
      const found = searchJsonForCCU(v, p);
      if (found) return found;
    }
  }
  return null;
}

function headersToRecord(
  headers: Record<string, string> | undefined
): Record<string, string> {
  return { ...(headers ?? {}) };
}

async function safeReadResponseText(resp: Response): Promise<string | null> {
  try {
    const ct = resp.headers()["content-type"] ?? "";
    if (!ct.includes("json") && !ct.includes("text")) return null;
    const txt = await resp.text();
    return txt.slice(0, 8_000);
  } catch {
    return null;
  }
}

export async function discoverCCURequestsOnPage(
  page: Page,
  opts: { maxCandidates?: number; timeoutMs?: number } = {}
): Promise<DiscoveryCandidate[]> {
  const maxCandidates = opts.maxCandidates ?? 12;
  const timeoutMs = opts.timeoutMs ?? 25_000;

  const candidates: DiscoveryCandidate[] = [];

  const onResponse = async (resp: Response) => {
    if (candidates.length >= maxCandidates) return;
    const status = resp.status();
    if (status < 200 || status >= 400) return;

    const req: Request = resp.request();
    const url = req.url();
    const method = req.method();

    // Only focus on likely data calls.
    const resourceType = req.resourceType();
    if (resourceType !== "xhr" && resourceType !== "fetch") return;

    const snippet = await safeReadResponseText(resp);
    if (!snippet) return;

    let detected: { ccu: number; jsonPath: string } | null = null;
    if (snippet.trim().startsWith("{") || snippet.trim().startsWith("[")) {
      try {
        const json = JSON.parse(snippet);
        detected = searchJsonForCCU(json);
      } catch {
        // ignore non-json responses
      }
    }

    const postData = req.postData();
    candidates.push({
      url,
      method,
      status,
      requestHeaders: headersToRecord(req.headers()),
      requestPostData: postData ?? undefined,
      responseHeaders: headersToRecord(resp.headers()),
      responseSnippet: snippet,
      detectedCCU: detected?.ccu,
      detectedPath: detected?.jsonPath,
    });
  };

  page.on("response", onResponse);
  try {
    await page.waitForLoadState("networkidle", { timeout: timeoutMs });
    // Give SPA a tiny buffer to fetch late requests.
    await page.waitForTimeout(1500);
  } finally {
    page.off("response", onResponse);
  }

  // Highest signal first: detected CCU values.
  return candidates
    .slice()
    .sort((a, b) => Number(Boolean(b.detectedCCU)) - Number(Boolean(a.detectedCCU)));
}

