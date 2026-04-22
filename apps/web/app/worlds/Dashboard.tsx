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

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

function fmtTime(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function Dashboard() {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);

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
  }

  useEffect(() => {
    refresh().catch((e) => setError(e?.message ?? "Failed to load worlds"));
  }, []);

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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>Add world</h2>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://horizon.meta.com/world/462305146410908/"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(0,0,0,0.2)",
              color: "inherit",
            }}
          />
          <button
            disabled={isAdding || !newUrl.trim()}
            onClick={() => onAddWorld()}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              background: isAdding ? "rgba(255,255,255,0.12)" : "#2563eb",
              color: "white",
              cursor: isAdding ? "not-allowed" : "pointer",
            }}
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </div>
        {error ? (
          <p style={{ marginTop: 12, color: "#fca5a5" }}>{error}</p>
        ) : null}
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Worlds</h2>
          <button
            onClick={() => refresh()}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>

        {worlds == null ? (
          <p style={{ color: "rgba(255,255,255,0.7)" }}>Loading…</p>
        ) : worlds.length === 0 ? (
          <p style={{ color: "rgba(255,255,255,0.7)" }}>
            No worlds yet. Add one above.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {worlds.map((w) => (
              <div
                key={w.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 12,
                  padding: 14,
                  background: "rgba(0,0,0,0.12)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: "hidden" }}>
                      {w.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.6)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={w.url}
                    >
                      {w.url}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                      Current CCU
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>
                      {w.latestCCU ?? "—"}
                    </div>
                  </div>
                </div>

                {w.lastError ? (
                  <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 12 }}>
                    Last error: {w.lastError}
                  </div>
                ) : w.lastSuccessfulAt ? (
                  <div
                    style={{ marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 12 }}
                  >
                    Last success: {fmtTime(w.lastSuccessfulAt)}
                  </div>
                ) : (
                  <div
                    style={{ marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 12 }}
                  >
                    Not scraped yet
                  </div>
                )}

                {w.latestCapturedAt ? (
                  <div
                    style={{
                      marginTop: 6,
                      color: "rgba(255,255,255,0.6)",
                      fontSize: 12,
                    }}
                  >
                    Latest sample: {fmtTime(w.latestCapturedAt)}
                  </div>
                ) : null}

                <div style={{ marginTop: 12 }}>
                  <Link href={`/world/${w.id}`}>View graph →</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

