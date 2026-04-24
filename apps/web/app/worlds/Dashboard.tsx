 "use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type World = {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
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

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

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
  const [statsLoading, setStatsLoading] = useState(false);

  const client = useMemo(
    () =>
      axios.create({
        baseURL: API_BASE,
      }),
    []
  );

  async function refresh() {
    setError(null);
    const res = await client.get<World[]>("/worlds");
    setWorlds(res.data);
    await refresh24hStats(res.data);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e?.message ?? "Failed to load worlds"));
  }, []);

  async function refresh24hStats(ws: World[]) {
    setStatsLoading(true);
    try {
      const results = await mapWithConcurrency(ws, 4, async (w) => {
        const res = await client.get<Snapshot[]>(`/worlds/${w.id}/ccu`, {
          params: { range: "24h" },
        });
        return [w.id, compute24hStats(res.data, w.latestCCU)] as const;
      });
      const next: Record<string, WorldStats24h> = {};
      for (const [id, s] of results) next[id] = s;
      setStats24h(next);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? "Failed to load 24h stats");
    } finally {
      setStatsLoading(false);
    }
  }

  async function onAddWorld() {
    setIsAdding(true);
    setError(null);
    try {
      await client.post("/worlds", { url: newUrl });
      setNewUrl("");
      const res = await client.get<World[]>("/worlds");
      setWorlds(res.data);
      await refresh24hStats(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? "Failed to add world");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="cardHeader">
          <h2>Worlds (SteamCharts-style)</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="button"
              onClick={async () => {
                const res = await client.get<World[]>("/worlds");
                setWorlds(res.data);
                await refresh24hStats(res.data);
              }}
              disabled={worlds == null || statsLoading}
            >
              {statsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="cardBody">
          {error ? <p style={{ color: "var(--negative)" }}>{error}</p> : null}

          {worlds == null ? (
            <p className="muted">Loading…</p>
          ) : worlds.length === 0 ? (
            <p className="muted">No worlds yet.</p>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: "48%" }}>World</th>
                    <th className="num">Current Players</th>
                    <th className="num">24h Peak</th>
                    <th className="num">24h Change</th>
                    <th>Last Sample</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {worlds.map((w) => {
                    const s = stats24h[w.id];
                    const change = s?.change24hPct ?? null;
                    const changeClass =
                      change == null ? "" : change >= 0 ? "deltaPos" : "deltaNeg";

                    return (
                      <tr key={w.id}>
                        <td style={{ maxWidth: 1 }}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <Link href={`/world/${w.id}`} style={{ color: "var(--link)", fontWeight: 700 }}>
                              {w.name}
                            </Link>
                            <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={w.url}>
                              {w.url}
                            </div>
                          </div>
                        </td>
                        <td className="num">{fmtInt(s?.current ?? w.latestCCU)}</td>
                        <td className="num">{fmtInt(s?.peak24h ?? null)}</td>
                        <td className={`num ${changeClass}`}>{fmtPct(change)}</td>
                        <td>{fmtTime(w.latestCapturedAt) ?? "—"}</td>
                        <td>
                          {w.lastError ? (
                            <span className="pill" style={{ color: "var(--negative)" }}>
                              Error
                            </span>
                          ) : w.lastSuccessfulAt ? (
                            <span className="pill">OK</span>
                          ) : (
                            <span className="pill muted">Pending</span>
                          )}
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
    </div>
  );
}

