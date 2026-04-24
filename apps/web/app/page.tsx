import { Dashboard } from "./worlds/Dashboard";

export default function Home() {
  return (
    <div className="container">
      <header className="topbar">
        <div className="brand">
          <h1>Horizon Charts</h1>
          <p>Concurrent users per world, SteamCharts-style.</p>
        </div>
        <nav className="nav">
          <a href="/worlds">Worlds</a>
        </nav>
      </header>

      <main>
        <Dashboard />
      </main>
    </div>
  );
}
