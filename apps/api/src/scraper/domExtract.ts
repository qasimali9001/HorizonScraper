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

export function extractCCUFromText(text: string): DomExtractResult {
  // Try common patterns: "1,234 players online", "Active players: 532", "1.2K online", "17 here now"
  const patterns: RegExp[] = [
    /([\d,.]+)\s*(?:players|online|active)\b/i,
    /\b(?:players|online|active)\s*[:\-]?\s*([\d,.]+)\b/i,
    /([\d.]+)\s*(k|m)\s*(?:players|online|active)\b/i,
    /([\d,.]+)\s*here\s*now\b/i,
    /\bhere\s*now\s*[:\-]?\s*([\d,.]+)\b/i,
  ];

  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;

    const raw = match[1] ?? "";
    const maybe = parseCompactNumber(
      match[2] ? `${raw}${match[2]}` : raw.replace(/[^\d.,km]/gi, "")
    );
    if (maybe == null) return { ok: false, reason: "parse_failed" };
    if (maybe < 0) return { ok: false, reason: "parse_failed" };
    return { ok: true, ccu: maybe, rawMatch: match[0] };
  }

  return { ok: false, reason: "no_match" };
}

