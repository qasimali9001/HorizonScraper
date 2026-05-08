export type DomExtractResult =
  | { ok: true; ccu: number; rawMatch: string }
  | { ok: false; reason: "no_match" | "parse_failed" };

function parseCompactNumber(s: string): number | null {
  const trimmed = s.trim().toLowerCase().replace(/,/g, "");
  const m = trimmed.match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = m[2]?.toLowerCase();
  if (!suffix) return Math.round(base);
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  return null;
}

/**
 * Returns true if the regex match appears in a time-relative context like
 * "Last active 8 hours ago" or "Online 5 mins ago". Those are not CCU values.
 */
function isLikelyTimeRelative(text: string, match: RegExpMatchArray): boolean {
  const idx = match.index ?? -1;
  if (idx < 0) return false;

  const after = text
    .slice(idx + match[0].length, idx + match[0].length + 32)
    .toLowerCase();
  const before = text.slice(Math.max(0, idx - 32), idx).toLowerCase();

  // Phrases that look like times: "8 hours ago", "5 mins ago", "2 days ago".
  const timeAfter =
    /^\s*(?:second|sec|minute|min|hour|hr|day|week|month|year|yr)s?\b/i.test(after) ||
    /^\s*\w*\s*(?:ago|earlier|later)\b/.test(after);

  // Number is part of unrelated counts.
  const unrelatedAfter =
    /^\s*(?:followers?|likes?|reviews?|ratings?|comments?|reactions?|stars?|worlds?|creators?)\b/.test(
      after
    );

  // "last active", "was active", "recently active" before number.
  const activityBefore = /\b(?:last|was|recently|previously)\s+$/.test(before);

  return timeAfter || unrelatedAfter || activityBefore;
}

export function extractCCUFromText(text: string): DomExtractResult {
  // Patterns ordered from most specific (Horizon-style) to general.
  // We deliberately avoid the standalone keyword "active" because it appears
  // in phrases like "Last active 8 hours ago" that are not CCU.
  const patterns: RegExp[] = [
    /([\d,.]+)\s*here\s*now\b/i,
    /\bhere\s*now\s*[:\-]?\s*([\d,.]+)\b/i,
    /([\d,.]+)\s*players?\s+(?:online|here|now)\b/i,
    /\b(?:active\s+)?players?\s*[:\-]?\s*([\d,.]+)\b/i,
    /\b(?:players|users)\s+online\s*[:\-]?\s*([\d,.]+)\b/i,
    /([\d,.]+)\s*(?:players|users)\s+online\b/i,
    /([\d.]+)\s*(k|m)\s*(?:players|online)\b/i,
    /([\d,.]+)\s*(?:players|online)\b/i,
  ];

  let sawParseFailure = false;
  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;

    if (isLikelyTimeRelative(text, match)) {
      sawParseFailure = true;
      continue;
    }

    const raw = match[1] ?? "";
    const maybe = parseCompactNumber(
      match[2] ? `${raw}${match[2]}` : raw.replace(/[^\d.,km]/gi, "")
    );
    if (maybe == null || maybe < 0) {
      // Some pages contain unrelated numbers that match a broad pattern.
      // Keep scanning for more specific matches (e.g. "49 here now").
      sawParseFailure = true;
      continue;
    }
    return { ok: true, ccu: maybe, rawMatch: match[0] };
  }

  return { ok: false, reason: sawParseFailure ? "parse_failed" : "no_match" };
}
