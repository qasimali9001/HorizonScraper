"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = {
  capturedAt: string;
  totalCCU: number | null;
  avgCCU: number | null;
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

export function PlatformLineChart({ data }: { data: Point[] }) {
  const chartData = data.map((d) => ({
    ts: new Date(d.capturedAt).getTime(),
    totalCCU: d.totalCCU,
    avgCCU: d.avgCCU,
  }));

  const minTs = chartData[0]?.ts ?? Date.now();
  const maxTs = chartData[chartData.length - 1]?.ts ?? Date.now();
  const axis = pickTimeAxis(maxTs - minTs);
  const ticks = axis.ticks(minTs, maxTs);

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
          <YAxis yAxisId="left" stroke="rgba(255,255,255,0.6)" />
          <YAxis yAxisId="right" orientation="right" stroke="rgba(255,255,255,0.45)" />
          <Tooltip
            labelFormatter={(v) => axis.tooltipFormatter(Number(v))}
            formatter={(value, name) => {
              if (typeof value !== "number") return ["—", String(name)];
              const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
              return [fmt, name === "totalCCU" ? "Total CCU" : "Avg CCU"];
            }}
            contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.15)" }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="totalCCU"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgCCU"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

