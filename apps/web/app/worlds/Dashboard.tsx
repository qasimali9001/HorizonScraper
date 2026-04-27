 "use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type World = {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  isFavorite: boolean;
  createdAt: string;
  lastSuccessfulAt: string | null;
  lastError: string | null;
  latestCCU: number | null;
  latestCapturedAt: string | null;
};

type Snapshot = { ccu: number; capturedAt: string };
type WorldStats24h = {
  current: number | null;
  peak24h: number | null;
  change24hPct: number | null;
};

type WorldSummaryRow = World & { stats24h: WorldStats24h; spark24h: number[] };

type CollectorStatus = {
  ok: true;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

function SortableTH({
  label,
  col,
  active,
  dir,
  onToggle,
  sortable = true,
  style,
  className,
}: {
  label: string;
  col: "name" | "current" | "peak24h" | "change24h" | "trend" | "status";
  active: string;
  dir: "asc" | "desc";
  onToggle: (col: "name" | "current" | "peak24h" | "change24h" | "trend" | "status") => void;
  sortable?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  const isActive = active === col;
  const indicator = isActive ? (dir === "asc" ? " ▲" : " ▼") : "";
  return (
    <th
      className={className}
      style={{
        ...(style ?? {}),
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
      }}
      onClick={sortable ? () => onToggle(col) : undefined}
      title={sortable ? "Click to sort" : undefined}
    >
      {label}
      <span className="muted" style={{ marginLeft: 4 }}>
        {indicator}
      </span>
    </th>
  );
}

function fmtTime(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fmtInt(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat().format(v);
}

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function compute24hStats(snapshots: Snapshot[], fallbackCurrent: number | null): WorldStats24h {
  if (snapshots.length === 0) {
    return { current: fallbackCurrent, peak24h: null, change24hPct: null };
  }
  const values = snapshots.map((s) => s.ccu);
  const peakFromSnapshots = values.reduce((m, v) => (v > m ? v : m), values[0] ?? 0);
  const currentFromSnapshots = values[values.length - 1] ?? null;
  const current = currentFromSnapshots ?? fallbackCurrent;
  const peak24h =
    current != null ? Math.max(peakFromSnapshots, current) : peakFromSnapshots;
  const first = values[0] ?? null;
  const change24hPct =
    first == null || first === 0 || current == null ? null : ((current - first) / first) * 100;
  return { current: current ?? fallbackCurrent, peak24h, change24hPct };
}

function downsample(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.floor((i * (values.length - 1)) / (maxPoints - 1));
    out.push(values[idx]!);
  }
  return out;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 110;
  const h = 28;
  if (values.length < 2) {
    return <span className="muted">—</span>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 2) + 1;
      const y = h - 1 - ((v - min) / span) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="24 hour trend">
      <polyline
        points={points}
        fill="none"
        stroke="rgba(96,165,250,0.9)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export function Dashboard() {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [stats24h, setStats24h] = useState<Record<string, WorldStats24h>>({});
  const [sparks24h, setSparks24h] = useState<Record<string, number[]>>({});
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<
    "name" | "current" | "peak24h" | "change24h" | "trend" | "status"
  >("current");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [isUpdatingCCU, setIsUpdatingCCU] = useState(false);
  const [jobSecret, setJobSecret] = useState<string>("");
  const [favorites, setFavorites] = useState<WorldSummaryRow[]>([]);
  const [nonFavorites, setNonFavorites] = useState<WorldSummaryRow[]>([]);

  function toggleSort(col: "name" | "current" | "peak24h" | "change24h" | "trend" | "status") {
    if (sortBy === col) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
      return;
    }
    setSortBy(col);
    // Default direction per column
    const defaultDir: Record<typeof col, "asc" | "desc"> = {
      name: "asc",
      current: "desc",
      peak24h: "desc",
      change24h: "desc",
      trend: "desc",
      status: "desc",
    } as any;
    setSortDir(defaultDir[col] ?? "desc");
  }

  const client = useMemo(
    () =>
      axios.create({
        baseURL: API_BASE,
      }),
    []
  );

  async function refresh() {
    setError(null);
    const res = await client.get<WorldSummaryRow[]>("/worlds/summary");
    const data = res.data;
    setFavorites(data.filter((w) => w.isFavorite));
    setNonFavorites(data.filter((w) => !w.isFavorite));

    const ws = data.map(({ stats24h, spark24h, ...w }) => w);
    setWorlds(ws);
    const nextStats: Record<string, WorldStats24h> = {};
    const nextSparks: Record<string, number[]> = {};
    for (const row of data) {
      nextStats[row.id] = row.stats24h;
      nextSparks[row.id] = row.spark24h;
    }
    setStats24h(nextStats);
    setSparks24h(nextSparks);
  }
  async function toggleFavorite(worldId: string, next: boolean) {
    setError(null);
    try {
      await client.post(`/worlds/${worldId}/favorite`, { isFavorite: next });
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? "Failed to update favorite");
    }
  }

  function renderTable(title: string, rowsToRender: typeof rows) {
    return (
      <div className="card">
        <div className="cardHeader">
          <h2>{title}</h2>
          <div className="controlsRow" style={{ flex: 1, justifyContent: "flex-end" }}>
            <input
              className="input controlLg"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search worlds…"
            />
          </div>
        </div>
        <div className="cardBody">
          {error ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ color: "var(--negative)", margin: 0 }}>{error}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                API base: <code>{API_BASE}</code> ·{" "}
                <a href={`${API_BASE}/health`} target="_blank" rel="noreferrer">
                  open /health
                </a>
              </p>
            </div>
          ) : null}
          {worlds == null ? (
            <p className="muted">Loading…</p>
          ) : rowsToRender.length === 0 ? (
            <p className="muted">No worlds.</p>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }} title="Favorite">
                      ★
                    </th>
                    <SortableTH
                      label="World"
                      col="name"
                      active={sortBy}
                      dir={sortDir}
                      onToggle={(c) => toggleSort(c)}
                      style={{ width: "48%" }}
                    />
                    <SortableTH
                      label="Current Players"
                      col="current"
                      active={sortBy}
                      dir={sortDir}
                      onToggle={(c) => toggleSort(c)}
                      className="num"
                    />
                    <SortableTH
                      label="24h Peak"
                      col="peak24h"
                      active={sortBy}
                      dir={sortDir}
                      onToggle={(c) => toggleSort(c)}
                      className="num hideMobile"
                    />
                    <SortableTH
                      label="24h Change"
                      col="change24h"
                      active={sortBy}
                      dir={sortDir}
                      onToggle={(c) => toggleSort(c)}
                      className="num hideMobile"
                    />
                    <SortableTH
                      label="24h"
                      col="trend"
                      active={sortBy}
                      dir={sortDir}
                      onToggle={(c) => toggleSort(c)}
                      sortable={false}
                      className="hideMobile"
                    />
                    <SortableTH
                      label="Status"
                      col="status"
                      active={sortBy}
                      dir={sortDir}
                      onToggle={(c) => toggleSort(c)}
                    />
                  </tr>
                </thead>
                <tbody>
                  {rowsToRender.map(({ w, current, peak24h, change24hPct, spark }) => {
                    const change = change24hPct ?? null;
                    const changeClass =
                      change == null ? "" : change >= 0 ? "deltaPos" : "deltaNeg";

                    return (
                      <tr key={w.id}>
                        <td>
                          <button
                            className="button"
                            style={{
                              padding: "6px 8px",
                              background: "transparent",
                            }}
                            onClick={() => toggleFavorite(w.id, !w.isFavorite)}
                            title={w.isFavorite ? "Unfavorite" : "Favorite"}
                          >
                            {w.isFavorite ? "★" : "☆"}
                          </button>
                        </td>
                        <td style={{ maxWidth: 1 }}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <Link href={`/world/${w.id}`} style={{ color: "var(--link)", fontWeight: 700 }}>
                              <span className="worldTitle">{w.name}</span>
                            </Link>
                            <div
                              className="muted"
                              style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                              title={w.url}
                            >
                              {w.url}
                            </div>
                          </div>
                        </td>
                        <td className="num">{fmtInt(current ?? null)}</td>
                        <td className="num hideMobile">{fmtInt(peak24h ?? null)}</td>
                        <td className={`num ${changeClass} hideMobile`}>{fmtPct(change)}</td>
                        <td className="hideMobile">
                          <Sparkline values={spark} />
                        </td>
                        <td>
                          {w.isActive === false ? (
                            <span className="pill muted">Not tracked</span>
                          ) : w.lastError && !w.lastSuccessfulAt ? (
                            <span
                              className="pill"
                              style={{ color: "var(--negative)" }}
                              title={w.lastError}
                            >
                              Error
                            </span>
                          ) : w.lastSuccessfulAt ? (
                            <span
                              className="pill"
                              title={w.lastError ? `Last error: ${w.lastError}` : undefined}
                            >
                              OK{w.lastError ? " (recovered)" : ""}
                            </span>
                          ) : (
                            <span className="pill muted">Pending</span>
                          )}

                          <span style={{ marginLeft: 10, display: "inline-flex", gap: 8 }}>
                            <button
                              className="button"
                              onClick={() => onRefreshWorld(w.id)}
                              style={{ padding: "8px 10px" }}
                              title="Scrape CCU for this world now"
                            >
                              Refresh
                            </button>
                            {w.isActive === false ? (
                              <button
                                className="button"
                                onClick={() => setTracking(w.id, true)}
                                style={{ padding: "8px 10px" }}
                              >
                                Resume
                              </button>
                            ) : (
                              <button
                                className="button"
                                onClick={() => setTracking(w.id, false)}
                                style={{ padding: "8px 10px" }}
                              >
                                Stop
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  useEffect(() => {
    refresh().catch((e) => setError(e?.message ?? "Failed to load worlds"));
  }, []);

  const rows = useMemo(() => {
    if (!worlds) return [];
    const q = query.trim().toLowerCase();

    const base = worlds
      .map((w) => {
        const s = stats24h[w.id];
        const current = s?.current ?? w.latestCCU;
        const peak24h = s?.peak24h ?? null;
        const change24hPct = s?.change24hPct ?? null;
        const status: "ok" | "error" | "pending" = w.lastError
          ? "error"
          : w.lastSuccessfulAt
            ? "ok"
            : "pending";

        const spark = sparks24h[w.id] ?? [];
        return { w, current, peak24h, change24hPct, status, spark };
      })
      .filter(({ w }) => {
        if (
          q &&
          !w.name.toLowerCase().includes(q) &&
          !w.url.toLowerCase().includes(q)
        )
          return false;
        return true;
      });

    const dir = sortDir === "asc" ? 1 : -1;
    const by = sortBy;

    const statusRank = (s: "ok" | "pending" | "error") => (s === "error" ? 2 : s === "pending" ? 1 : 0);

    base.sort((a, b) => {
      if (by === "name") return a.w.name.localeCompare(b.w.name) * dir;
      if (by === "current") return ((a.current ?? -1) - (b.current ?? -1)) * dir;
      if (by === "peak24h") return ((a.peak24h ?? -1) - (b.peak24h ?? -1)) * dir;
      if (by === "change24h")
        return ((a.change24hPct ?? -999999) - (b.change24hPct ?? -999999)) * dir;
      if (by === "trend") {
        // Sort by net delta over spark window if available.
        const da =
          a.spark.length >= 2 ? a.spark[a.spark.length - 1]! - a.spark[0]! : -999999;
        const db =
          b.spark.length >= 2 ? b.spark[b.spark.length - 1]! - b.spark[0]! : -999999;
        return (da - db) * dir;
      }
      // status
      return (statusRank(a.status) - statusRank(b.status)) * dir;
    });

    return base;
  }, [worlds, stats24h, sparks24h, query, sortBy, sortDir]);

  // 24h stats and sparklines are now loaded in a single call via /worlds/summary.

  async function onAddWorld() {
    setIsAdding(true);
    setError(null);
    try {
      await client.post("/worlds", { url: newUrl });
      setNewUrl("");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? "Failed to add world");
    } finally {
      setIsAdding(false);
    }
  }

  async function setTracking(worldId: string, isActive: boolean) {
    const expected = isActive ? "STARTTHECOUNT" : "STOPTHECOUNT";
    const password = globalThis.prompt(`Type "${expected}" to confirm:`) ?? "";
    if (password.trim() !== expected) return;

    await client.post(`/worlds/${worldId}/setActive`, { isActive, password: expected });
    await refresh();
  }
  function loadJobSecret(): string {
    try {
      return globalThis.localStorage?.getItem("jobSecret") ?? "";
    } catch {
      return "";
    }
  }

  function saveJobSecret(secret: string) {
    try {
      globalThis.localStorage?.setItem("jobSecret", secret);
    } catch {
      // ignore
    }
  }

  async function requireJobSecret(): Promise<string> {
    let secret = jobSecret || loadJobSecret();
    if (!secret) {
      secret = globalThis.prompt("Enter JOB_SECRET:") ?? "";
    }
    secret = secret.trim();
    if (!secret) throw new Error("missing_job_secret");
    setJobSecret(secret);
    saveJobSecret(secret);
    return secret;
  }

  async function waitForCollectorToFinish(startedAt: number): Promise<void> {
    // Poll until lastFinishedAt is after startedAt (or running flips false).
    const maxMs = 3 * 60 * 1000;
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      const res = await client.get<CollectorStatus>("/jobs/ccuCollector/status", {
        headers: jobSecret ? { "x-job-secret": jobSecret } : undefined,
      });
      const lastFinished = res.data.lastFinishedAt ? Date.parse(res.data.lastFinishedAt) : NaN;
      if (!res.data.running && Number.isFinite(lastFinished) && lastFinished >= startedAt) return;
      if (!res.data.running && !Number.isFinite(lastFinished)) return;
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error("collector_timeout");
  }

  async function onUpdateCCUs() {
    setIsUpdatingCCU(true);
    setError(null);
    try {
      const ok = globalThis.confirm(
        "Update CCUs will scrape each world and can take a while (throttled to avoid Meta rate limits).\n\nPlease don't spam this button or run it at the same time as the GitHub scheduler.\n\nContinue?"
      );
      if (!ok) return;

      const secret = await requireJobSecret();

      // If a run is already happening (e.g. GitHub schedule), wait rather than starting another.
      const statusRes = await client.get<CollectorStatus>("/jobs/ccuCollector/status", {
        headers: { "x-job-secret": secret },
      });

      const startedAt = statusRes.data.running
        ? Date.parse(statusRes.data.lastStartedAt ?? "") || Date.now()
        : Date.now();

      if (!statusRes.data.running) {
        await client.post(
          "/jobs/ccuCollector/runOnce",
          {},
          { headers: { "x-job-secret": secret, "content-type": "application/json" } }
        );
      }

      await waitForCollectorToFinish(startedAt);
      await refresh();
    } catch (e: any) {
      // If the collector is running or completed but our polling timed out/network hiccuped,
      // refresh the table anyway and avoid showing a scary error when data updated.
      try {
        await refresh();
        setError(null);
        return;
      } catch {
        // ignore and fall through to show error
      }

      setError(e?.response?.data?.message ?? e?.message ?? "Failed to update CCUs");
    } finally {
      setIsUpdatingCCU(false);
    }
  }

  async function onRefreshWorld(worldId: string) {
    setError(null);
    try {
      const ok = globalThis.confirm(
        "This will scrape CCU for ONE world now.\n\nPlease don't mass-refresh lots of worlds quickly (Meta can rate limit/temporarily block).\n\nContinue?"
      );
      if (!ok) return;

      const secret = await requireJobSecret();
      await client.post(
        `/worlds/${worldId}/collectNow`,
        {},
        { headers: { "x-job-secret": secret, "content-type": "application/json" } }
      );
      await refresh();
    } catch (e: any) {
      // If the scrape likely ran but the request errored, refresh anyway and suppress the error
      // when the table loads successfully.
      try {
        await refresh();
        setError(null);
        return;
      } catch {
        // ignore and fall through
      }

      setError(e?.response?.data?.message ?? e?.message ?? "Failed to refresh world CCU");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {renderTable("Favorites", rows.filter(({ w }) => w.isFavorite))}
      {renderTable("All worlds", rows.filter(({ w }) => !w.isFavorite))}

      <div className="card">
        <div className="cardHeader">
          <h2>Add world</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            Admin helper
          </span>
        </div>
        <div className="cardBody" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://horizon.meta.com/world/462305146410908/"
            />
            <button
              className={`button buttonPrimary`}
              disabled={isAdding || !newUrl.trim()}
              onClick={() => onAddWorld()}
              style={{ whiteSpace: "nowrap" }}
            >
              {isAdding ? "Adding…" : "Add"}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Tip: after you add worlds, use Refresh to fetch 24h stats.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="button buttonPrimary"
          onClick={() => onUpdateCCUs()}
          disabled={isUpdatingCCU}
          style={{ padding: "10px 14px" }}
        >
          {isUpdatingCCU ? "Updating CCUs…" : "Update CCUs"}
        </button>
      </div>
    </div>
  );
}

