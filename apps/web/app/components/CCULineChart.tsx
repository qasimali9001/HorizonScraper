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

export function CCULineChart({ data }: { data: Snapshot[] }) {
  const chartData = data.map((d) => ({
    ccu: d.ccu,
    ts: new Date(d.capturedAt).getTime(),
    label: new Date(d.capturedAt).toLocaleString(),
  }));

  return (
    <div style={{ width: "100%", height: 380 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => new Date(v).toLocaleTimeString()}
            stroke="rgba(255,255,255,0.6)"
          />
          <YAxis stroke="rgba(255,255,255,0.6)" />
          <Tooltip
            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
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

