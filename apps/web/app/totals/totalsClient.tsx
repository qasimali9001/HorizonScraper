"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PlatformLineChart } from "../components/PlatformLineChart";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

type TotalsResponse = {
  ok: true;
  range: string;
  bucketMs: number;
  worlds: { total: number; active: number; withLatest: number };
  current: {
    totalCCU: number | null;
    avgCCU: number | null;
    capturedAtMax: string | null;
  };
  topWorlds: Array<{
    id: string;
    name: string;
    url: string;
    isActive: boolean;
    isFavorite: boolean;
    latestCCU: number | null;
    latestCapturedAt: string | null;
  }>;
  series: Array<{
    capturedAt: string;
    totalCCU: number | null;
    avgCCU: number | null;
    worldsWithData: number;
  }>;
};

function fmtInt(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat().format(Math.round(v));
}

function fmtTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function TotalsClient() {
  const [data, setData] = useState<TotalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => axios.create({ baseURL: API_BASE }), []);

  useEffect(() => {
    setError(null);
    client
      .get<TotalsResponse>("/worlds/totals", { params: { range: "all" } })
      .then((res) => setData(res.data))
      .catch((e) => setError(e?.message ?? "Failed to load totals"));
  }, []);

  return (
    <div className="container">
      <header className="topbar">
        <div className="brand">
          <h1>Totals</h1>
          <p className="muted">Platform-wide rollup across tracked worlds.</p>
        </div>
        <nav className="nav">
          <Link href="/">Worlds</Link>
        </nav>
      </header>

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
      ) : data == null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card">
            <div className="cardBody" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div className="pill">
                <span className="muted">Current total CCU</span>
                <span style={{ fontWeight: 800 }}>{fmtInt(data.current.totalCCU)}</span>
              </div>
              <div className="pill">
                <span className="muted">Current average CCU</span>
                <span style={{ fontWeight: 800 }}>{fmtInt(data.current.avgCCU)}</span>
              </div>
              <div className="pill">
                <span className="muted">Worlds</span>
                <span style={{ fontWeight: 800 }}>
                  {data.worlds.total} total · {data.worlds.active} active
                </span>
              </div>
              <div className="pill">
                <span className="muted">Latest sample</span>
                <span style={{ fontWeight: 700 }}>{fmtTime(data.current.capturedAtMax)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <h2>Platform trend</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                Range: all
              </span>
            </div>
            <div className="cardBody">
              {data.series.length === 0 ? (
                <p className="muted">No snapshots yet.</p>
              ) : (
                <PlatformLineChart data={data.series} />
              )}
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <h2>Top performers (current)</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                Sorted by latest CCU
              </span>
            </div>
            <div className="cardBody">
              {data.topWorlds.length === 0 ? (
                <p className="muted">No latest samples yet.</p>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>World</th>
                        <th className="num">Current players</th>
                        <th className="hideMobile">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topWorlds.map((w) => (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/world/${w.id}`}>{w.name}</Link>
                            <div className="muted" style={{ fontSize: 12 }}>
                              <a href={w.url} target="_blank" rel="noreferrer">
                                Horizon link
                              </a>
                            </div>
                          </td>
                          <td className="num" style={{ fontWeight: 800 }}>
                            {fmtInt(w.latestCCU)}
                          </td>
                          <td className="hideMobile">
                            {w.isActive ? (
                              <span className="pill">Tracking</span>
                            ) : (
                              <span className="pill" style={{ opacity: 0.7 }}>
                                Not tracked
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

