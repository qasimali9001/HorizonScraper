"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = {
  capturedAt: string;
  totalCCU: number | null;
};

type WorldAddedEvent = {
  id: string;
  name: string;
  createdAt: string;
};

function floorToDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function floorToMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function buildTicks(opts: { minTs: number; maxTs: number; stepMs: number; floor: (ts: number) => number }): number[] {
  const start = opts.floor(opts.minTs);
  const ticks: number[] = [];
  for (let t = start; t <= opts.maxTs; t += opts.stepMs) ticks.push(t);
  return ticks;
}

function pickTimeAxis(spanMs: number): {
  tickFormatter: (v: number) => string;
  tooltipFormatter: (v: number) => string;
  ticks: (minTs: number, maxTs: number) => number[] | undefined;
} {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const spanDays = spanMs / day;

  if (spanDays <= 2) {
    return {
      tickFormatter: (v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      tooltipFormatter: (v) => new Date(v).toLocaleString(),
      ticks: () => undefined,
    };
  }

  if (spanDays <= 200) {
    const step = spanDays <= 14 ? day : 7 * day;
    return {
      tickFormatter: (v) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" }),
      tooltipFormatter: (v) => new Date(v).toLocaleString(),
      ticks: (minTs, maxTs) => buildTicks({ minTs, maxTs, stepMs: step, floor: floorToDay }),
    };
  }

  const step = 30 * day;
  return {
    tickFormatter: (v) => new Date(v).toLocaleDateString([], { month: "short", year: "numeric" }),
    tooltipFormatter: (v) => new Date(v).toLocaleString(),
    ticks: (minTs, maxTs) => buildTicks({ minTs, maxTs, stepMs: step, floor: floorToMonth }),
  };
}

export function PlatformLineChart({
  data,
  worldAddedEvents,
}: {
  data: Point[];
  worldAddedEvents: WorldAddedEvent[];
}) {
  const chartData = data.map((d) => ({
    ts: new Date(d.capturedAt).getTime(),
    totalCCU: d.totalCCU,
  }));

  const minTs = chartData[0]?.ts ?? Date.now();
  const maxTs = chartData[chartData.length - 1]?.ts ?? Date.now();
  const axis = pickTimeAxis(maxTs - minTs);
  const ticks = axis.ticks(minTs, maxTs);

  function nearestPoint(ts: number): { ts: number; totalCCU: number | null } | null {
    // chartData is already ordered ascending by time.
    if (chartData.length === 0) return null;
    let lo = 0;
    let hi = chartData.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (chartData[mid]!.ts < ts) lo = mid + 1;
      else hi = mid;
    }
    const right = chartData[lo] ?? null;
    const left = lo > 0 ? chartData[lo - 1] ?? null : null;

    const candidates = [left, right].filter(
      (v): v is NonNullable<typeof v> => v != null
    );
    let best: (typeof candidates)[number] | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const d = Math.abs(c.ts - ts);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best ? { ts: best.ts, totalCCU: best.totalCCU } : null;
  }

  // Snap event markers to the nearest platform datapoint so:
  // - marker sits on the line (y) AND
  // - marker aligns to the same x used by the tooltip (fixes "sticky" hover)
  const bySnappedTs = new Map<number, { ts: number; y: number; names: string[]; at: string[] }>();
  for (const e of worldAddedEvents ?? []) {
    const rawTs = new Date(e.createdAt).getTime();
    const p = nearestPoint(rawTs);
    const y = typeof p?.totalCCU === "number" ? p.totalCCU : null;
    if (!p || y == null || !Number.isFinite(y)) continue;

    const existing = bySnappedTs.get(p.ts);
    if (existing) {
      existing.names.push(e.name);
      existing.at.push(e.createdAt);
    } else {
      bySnappedTs.set(p.ts, { ts: p.ts, y, names: [e.name], at: [e.createdAt] });
    }
  }
  const eventPoints = Array.from(bySnappedTs.values()).sort((a, b) => a.ts - b.ts);
  const eventByTs = buildEventMap(eventPoints);

  function buildEventMap(points: Array<{ ts: number; names: string[] }>) {
    const map = new Map<number, string[]>();
    for (const p of points) map.set(p.ts, p.names);
    return map;
  }

  function Square(props: any) {
    const { cx, cy } = props;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const size = 8;
    return (
      <rect
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        fill="#f59e0b"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={1}
        rx={1}
        ry={1}
      />
    );
  }

  return (
    <div style={{ width: "100%", height: 380 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={(v) => axis.tickFormatter(Number(v))}
            stroke="rgba(255,255,255,0.6)"
          />
          <YAxis stroke="rgba(255,255,255,0.6)" />
          <Tooltip
            shared
            content={({ active, label, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              // Make tooltip snap to the LINE's x-value, not the scatter series.
              const baseTs = Number(label);
              const labelStr = axis.tooltipFormatter(baseTs);

              const total = payload.find((p: any) => p?.dataKey === "totalCCU") as any;

              const totalVal =
                typeof total?.value === "number"
                  ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(total.value)
                  : "—";

              const names = eventByTs.get(baseTs) ?? [];
              const worldAddedLine =
                names.length === 0
                  ? null
                  : `World added: ${names.join(", ")}`;

              return (
                <div
                  style={{
                    background: "rgba(0,0,0,0.85)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    padding: 10,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{labelStr}</div>
                  <div style={{ color: "#60a5fa" }}>Total CCU: {totalVal}</div>
                  {worldAddedLine ? (
                    <div style={{ marginTop: 6, color: "#f59e0b" }}>{worldAddedLine}</div>
                  ) : null}
                </div>
              );
            }}
            contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.15)" }}
          />
          <Line
            type="monotone"
            dataKey="totalCCU"
            stroke="#60a5fa"
            strokeWidth={2}
            // Keep chart visually clean, but ensure every point is hoverable so the tooltip
            // tracks correctly across the whole timeline.
            dot={{ r: 6, fill: "transparent", stroke: "transparent" }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
            connectNulls={false}
          />

          <Scatter data={eventPoints} dataKey="y" shape={<Square />} tooltipType="none" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

