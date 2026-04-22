import Link from "next/link";
import { Dashboard } from "./worlds/Dashboard";

export default function Home() {
  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
            Horizon CCU Tracker
          </h1>
          <p style={{ marginTop: 8, color: "rgba(255,255,255,0.7)" }}>
            Track concurrent users over time per world.
          </p>
        </div>
        <Link href="/worlds" style={{ alignSelf: "center" }}>
          Open dashboard
        </Link>
      </header>

      <main style={{ marginTop: 24 }}>
        <Dashboard />
      </main>
    </div>
  );
}
