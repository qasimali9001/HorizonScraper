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

type Snapshot = {
  ccu: number;
  capturedAt: string;
};

function floorToHour(ts: number): number {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

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

function buildHourlyTicks(opts: { minTs: number; maxTs: number; stepHours: number }): number[] {
  const stepMs = opts.stepHours * 60 * 60 * 1000;
  const start = floorToHour(opts.minTs);
  const ticks: number[] = [];
  for (let t = start; t <= opts.maxTs; t += stepMs) ticks.push(t);
  return ticks;
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

  if (spanDays <= 1.5) {
    return {
      tickFormatter: (v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      tooltipFormatter: (v) => new Date(v).toLocaleString(),
      ticks: (minTs, maxTs) => buildHourlyTicks({ minTs, maxTs, stepHours: 4 }),
    };
  }

  if (spanDays <= 10) {
    return {
      tickFormatter: (v) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" }),
      tooltipFormatter: (v) => new Date(v).toLocaleString(),
      ticks: (minTs, maxTs) => buildTicks({ minTs, maxTs, stepMs: day, floor: floorToDay }),
    };
  }

  if (spanDays <= 45) {
    const step = 3 * day;
    return {
      tickFormatter: (v) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" }),
      tooltipFormatter: (v) => new Date(v).toLocaleString(),
      ticks: (minTs, maxTs) => buildTicks({ minTs, maxTs, stepMs: step, floor: floorToDay }),
    };
  }

  if (spanDays <= 200) {
    const step = 7 * day;
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

export function CCULineChart({
  data,
  windowHours,
  tickStepHours,
}: {
  data: Snapshot[];
  windowHours?: number | null;
  tickStepHours?: number | null;
}) {
  const baseData = data.map((d) => ({
    ccu: d.ccu,
    ts: new Date(d.capturedAt).getTime(),
    label: new Date(d.capturedAt).toLocaleString(),
  }));

  const minTsRaw = baseData[0]?.ts ?? Date.now();
  const maxTs = baseData[baseData.length - 1]?.ts ?? Date.now();

  // When windowHours is set (e.g. 24h view), we snap the visible axis to the window boundary.
  // The caller should provide one extra datapoint older than the window so the line slopes in.
  const hasWindow = typeof windowHours === "number" && windowHours > 0;

  const domainStart = hasWindow ? floorToHour(maxTs - windowHours * 60 * 60 * 1000) : "dataMin";
  const minTs = hasWindow ? (domainStart as number) : minTsRaw;
  const axis = pickTimeAxis(maxTs - minTs);
  const ticks =
    hasWindow && typeof tickStepHours === "number" && tickStepHours > 0
      ? buildHourlyTicks({ minTs, maxTs, stepHours: tickStepHours })
      : axis.ticks(minTs, maxTs);
  const chartData = (() => {
    if (!hasWindow) return baseData;
    const startTs = domainStart as number;
    if (!Number.isFinite(startTs) || baseData.length === 0) return baseData;

    // Desired behavior:
    // - If we have at least one point before startTs AND at least one point after startTs,
    //   the clipped line segment will naturally start at the y-axis without adding synthetic points.
    // - If we have NO point after startTs (collector gap), but we DO have a point before it,
    //   add a single boundary point using the last known CCU so the chart isn't empty.
    const hasAfter = baseData.some((p) => p.ts >= startTs);
    const lastBefore = [...baseData].reverse().find((p) => p.ts < startTs);

    if (!hasAfter && lastBefore) {
      return [
        {
          ts: startTs,
          ccu: lastBefore.ccu,
          label: new Date(startTs).toLocaleString(),
        },
        ...baseData,
      ];
    }

    return baseData;
  })();

  return (
    <div style={{ width: "100%", height: 380 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={[domainStart as any, "dataMax"]}
            ticks={ticks}
            tickFormatter={(v) => axis.tickFormatter(Number(v))}
            stroke="rgba(255,255,255,0.6)"
          />
          <YAxis stroke="rgba(255,255,255,0.6)" />
          <Tooltip
            labelFormatter={(v) => axis.tooltipFormatter(Number(v))}
            contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.15)" }}
          />
          <Line
            type="monotone"
            dataKey="ccu"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

