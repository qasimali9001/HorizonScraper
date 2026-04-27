 "use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CCULineChart } from "../../components/CCULineChart";

type Snapshot = {
  ccu: number;
  capturedAt: string;
};

type World = {
  id: string;
  name: string;
  url: string;
  lastError: string | null;
  lastSuccessfulAt: string | null;
  latestCCU: number | null;
  latestCapturedAt: string | null;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

const ranges = ["24h", "7d", "30d", "all"] as const;
type Range = (typeof ranges)[number];

function fmtInt(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat().format(v);
}

function fmtTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function computePeak(data: Snapshot[]): number | null {
  if (data.length === 0) return null;
  let max = data[0]!.ccu;
  for (const d of data) if (d.ccu > max) max = d.ccu;
  return max;
}

export function WorldDetail({ worldId }: { worldId: string }) {
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [world, setWorld] = useState<World | null>(null);

  const client = useMemo(() => axios.create({ baseURL: API_BASE }), []);

  useEffect(() => {
    setError(null);
    client
      .get<World[]>("/worlds")
      .then((res) => setWorld(res.data.find((w) => w.id === worldId) ?? null))
      .catch(() => setWorld(null));
  }, [worldId]);

  useEffect(() => {
    setData(null);
    setError(null);
    client
      .get<Snapshot[]>(`/worlds/${worldId}/ccu`, {
        params: {
          range,
          ...(range === "24h" || range === "7d" || range === "30d" ? { includePrev: "1" } : {}),
        },
      })
      .then((res) => setData(res.data))
      .catch((e) => setError(e?.message ?? "Failed to load CCU"));
  }, [worldId, range]);

  const current = data && data.length > 0 ? data[data.length - 1]!.ccu : world?.latestCCU ?? null;
  const peak = data ? computePeak(data) : null;

  return (
    <div className="container">
      <header className="topbar">
        <div className="brand">
          <h1>{world?.name ?? "World"}</h1>
          <p className="muted">
            {world?.url ? (
              <a href={world.url} target="_blank" rel="noreferrer">
                {world.url}
              </a>
            ) : (
              <>
                World ID: <code>{worldId}</code>
              </>
            )}
          </p>
        </div>
        <nav className="nav">
          <Link href="/">← Back</Link>
          <Link href="/totals">Totals</Link>
        </nav>
      </header>

      <div style={{ display: "grid", gap: 14 }}>
        <div className="card">
          <div className="cardBody" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div className="pill">
                <span className="muted">Current players</span>
                <span style={{ fontWeight: 800 }}>{fmtInt(current)}</span>
              </div>
              <div className="pill">
                <span className="muted">Peak ({range})</span>
                <span style={{ fontWeight: 800 }}>{fmtInt(peak)}</span>
              </div>
              <div className="pill">
                <span className="muted">Latest sample</span>
                <span style={{ fontWeight: 700 }}>{fmtTime(world?.latestCapturedAt ?? null)}</span>
              </div>
              <div className="pill">
                <span className="muted">Status</span>
                <span style={{ fontWeight: 800, color: world?.lastError ? "var(--negative)" : "inherit" }}>
                  {world?.lastError ? "Error" : world?.lastSuccessfulAt ? "OK" : "Pending"}
                </span>
              </div>
            </div>

            <div className="controlsRow">
              {ranges.map((r) => (
                <button
                  key={r}
                  className={`button ${range === r ? "buttonPrimary" : ""}`}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>

            {world?.lastError ? (
              <div className="muted" style={{ color: "var(--negative)" }}>
                Last error: {world.lastError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="cardHeader">
            <h2>Players</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Range: {range}
            </span>
          </div>
          <div className="cardBody">
            {error ? (
              <p style={{ color: "var(--negative)" }}>{error}</p>
            ) : data == null ? (
              <p className="muted">Loading…</p>
            ) : data.length === 0 ? (
              <p className="muted">No snapshots yet.</p>
            ) : (
              <CCULineChart
                data={data}
                windowHours={range === "24h" ? 24 : range === "7d" ? 7 * 24 : range === "30d" ? 30 * 24 : null}
                tickStepHours={range === "24h" ? 4 : null}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

