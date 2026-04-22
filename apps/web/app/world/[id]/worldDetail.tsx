 "use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CCULineChart } from "../../components/CCULineChart";

type Snapshot = {
  ccu: number;
  capturedAt: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

const ranges = ["24h", "7d", "30d", "all"] as const;
type Range = (typeof ranges)[number];

export function WorldDetail({ worldId }: { worldId: string }) {
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => axios.create({ baseURL: API_BASE }), []);

  useEffect(() => {
    setData(null);
    setError(null);
    client
      .get<Snapshot[]>(`/worlds/${worldId}/ccu`, { params: { range } })
      .then((res) => setData(res.data))
      .catch((e) => setError(e?.message ?? "Failed to load CCU"));
  }, [worldId, range]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <Link href="/worlds">← Back</Link>
          <h1 style={{ marginTop: 10, marginBottom: 0 }}>World detail</h1>
          <p style={{ marginTop: 8, color: "rgba(255,255,255,0.7)" }}>
            World ID: <code>{worldId}</code>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.16)",
                background: range === r ? "#2563eb" : "rgba(255,255,255,0.06)",
                color: "white",
                cursor: "pointer",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: 14,
          background: "rgba(0,0,0,0.12)",
        }}
      >
        {error ? (
          <p style={{ color: "#fca5a5" }}>{error}</p>
        ) : data == null ? (
          <p style={{ color: "rgba(255,255,255,0.7)" }}>Loading…</p>
        ) : data.length === 0 ? (
          <p style={{ color: "rgba(255,255,255,0.7)" }}>
            No snapshots yet. Run the collector job and refresh.
          </p>
        ) : (
          <CCULineChart data={data} />
        )}
      </div>
    </div>
  );
}

