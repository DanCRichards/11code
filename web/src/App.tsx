import { useCallback, useEffect, useState } from "react";
import { detectSameOriginBackend, startSource } from "./sources/controller";
import { load, store, useStore } from "./store";
import { clockTime, Icon, useBoard, useNow } from "./ui/common";
import { DataView } from "./ui/DataView";
import { LiveView } from "./ui/LiveView";
import { AppliancesView, LogView, StationsView } from "./ui/ListViews";
import type { Nav, Tab } from "./ui/nav";
import { ApplianceSheet, StationSheet } from "./ui/Sheets";

const TABS: [Tab, string, keyof typeof Icon][] = [
  ["live", "Live", "live"], ["appliances", "Appliances", "units"], ["stations", "Stations", "stations"],
  ["log", "Log", "log"], ["data", "Codebook", "data"],
];

function tabFromHash(): Tab {
  const h = typeof location !== "undefined" ? location.hash.slice(1) : "";
  return (TABS.find((t) => t[0] === h)?.[0]) ?? "live";
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [filter, setFilter] = useState<string>();
  const [sheet, setSheet] = useState<{ kind: "station" | "appliance"; id: string } | null>(null);
  const conn = useStore((s) => s.connection);
  const mode = useStore((s) => s.settings.mode);
  const speed = useStore((s) => s.settings.sim.speed);
  const { board } = useBoard();
  const now = useNow(1000);

  useEffect(() => {
    // First visit to a page served by the backend: go live automatically.
    if (!load("tb.settings")) {
      void detectSameOriginBackend().then((yes) => {
        if (yes) store.settings({ mode: "backend", backendUrl: "" });
        startSource();
      });
    } else startSource();
  }, []);
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((t: Tab, f?: string) => {
    setTab(t);
    setFilter(f);
    setSheet(null);
    try { history.replaceState(null, "", `#${t}`); } catch { /* sandboxed */ }
    window.scrollTo({ top: 0 });
  }, []);
  const nav: Nav = {
    tab: go,
    station: (id) => setSheet({ kind: "station", id }),
    appliance: (id) => setSheet({ kind: "appliance", id }),
  };

  const connLabel = mode === "demo" ? `Demo · ${speed}×` : { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", error: "Offline", demo: "Demo" }[conn.status];

  return (
    <div className="shell">
      <header className="top">
        <h1 className="brand">Auckland Turnouts</h1>
        <span className="spacer" />
        <button className={`conn ${mode === "demo" ? "demo" : conn.status}`} onClick={() => go("data", "source")} title="Data source">
          <i />{connLabel}
        </button>
        <span className="clock"><b>{clockTime(now)}</b></span>
      </header>
      <nav className="tabbar" aria-label="Sections">
        {TABS.map(([key, label, icon]) => (
          <button key={key} aria-current={tab === key ? "page" : undefined} onClick={() => go(key)}>
            {Icon[icon]}<span>{label}</span>
            {key === "data" && board.inbox.length > 0 && <span className="badge">{board.inbox.length}</span>}
          </button>
        ))}
      </nav>
      <main className="main" key={`${tab}:${filter ?? ""}`}>
        {tab === "live" && <LiveView nav={nav} />}
        {tab === "appliances" && <AppliancesView nav={nav} filter={filter} />}
        {tab === "stations" && <StationsView nav={nav} />}
        {tab === "log" && <LogView nav={nav} filter={filter} />}
        {tab === "data" && <DataView sub={filter} />}
      </main>
      {sheet?.kind === "station" && <StationSheet id={sheet.id} nav={nav} onClose={() => setSheet(null)} />}
      {sheet?.kind === "appliance" && <ApplianceSheet id={sheet.id} nav={nav} onClose={() => setSheet(null)} />}
    </div>
  );
}
