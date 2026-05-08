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

/**
 * Score a key for "is this CCU?" intent. Higher = more likely.
 * Returns 0 if the key is not CCU-like at all.
 */
function scoreCCUKey(key: string): number {
  const k = key.toLowerCase().replace(/[_-]/g, "");
  if (k === "ccu") return 100;
  if (k === "currentconcurrentusers" || k === "currentconcurrentplayers") return 95;
  if (k.includes("concurrent")) return 90;
  if (k === "playersonline" || k === "usersonline") return 85;
  if (k === "playercount" || k === "playerscount") return 80;
  if (k === "onlinecount" || k === "onlineusers" || k === "onlineplayers") return 80;
  // "activeUsers" / "active_players" are too ambiguous on Meta pages (they show
  // creator activity counts too). Only accept when paired with concurrency.
  if (k === "activeplayers" || k === "activeusers") return 30;
  return 0;
}

/**
 * Penalize matches that clearly belong to unrelated entities (creators,
 * viewers, friends, etc.) rather than the world itself.
 */
function pathContextPenalty(path: string[]): number {
  const joined = path.join(".").toLowerCase();
  let penalty = 0;
  for (const bad of [
    "creator",
    "owner",
    "publisher",
    "profile",
    "viewer",
    "friend",
    "you",
    "me",
    "follower",
  ]) {
    if (joined.includes(bad)) penalty += 50;
  }
  return penalty;
}

/**
 * Bonus for matches that look like they're describing the world we're
 * scraping (e.g. paths containing "world", "horizon", "instance").
 */
function pathContextBonus(path: string[]): number {
  const joined = path.join(".").toLowerCase();
  let bonus = 0;
  for (const good of ["world", "horizon", "instance", "session"]) {
    if (joined.includes(good)) bonus += 25;
  }
  return bonus;
}

type CCUCandidate = { ccu: number; jsonPath: string; score: number };

function collectCCUCandidates(
  node: unknown,
  path: string[],
  out: CCUCandidate[]
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      collectCCUCandidates(node[i], [...path, String(i)], out);
    }
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const p = [...path, k];
    const keyScore = scoreCCUKey(k);
    if (keyScore > 0) {
      const maybe = tryFindNumberLikeCCU(v);
      if (maybe != null) {
        const score = keyScore + pathContextBonus(p) - pathContextPenalty(p);
        // Require a minimum confidence to count.
        if (score >= 50) {
          out.push({ ccu: maybe, jsonPath: p.join("."), score });
        }
      }
    }
    collectCCUCandidates(v, p, out);
  }
}

function searchJsonForCCU(
  node: unknown
): { ccu: number; jsonPath: string } | null {
  const all: CCUCandidate[] = [];
  collectCCUCandidates(node, [], all);
  if (all.length === 0) return null;
  all.sort((a, b) => b.score - a.score);
  const best = all[0]!;
  return { ccu: best.ccu, jsonPath: best.jsonPath };
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

