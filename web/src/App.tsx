import { useCallback, useEffect, useState } from "react";
import { detectSameOriginBackend, startSource } from "./sources/controller";
import { load, store, useStore } from "./store";
import { clockTime, Icon, useBoard, useNow } from "./ui/common";
import { DataView } from "./ui/DataView";
import { LiveView } from "./ui/LiveView";
import { AppliancesView, LogView, StationsView } from "./ui/ListViews";
import type { Nav, Tab } from "./ui/nav";
import { ApplianceSheet, StationSheet } from "./ui/Sheets";
import { PlayerBar } from "./ui/Player";
import { unlockAlertAudio, useAlerts } from "./ui/alerts";
import { AlarmOverlay, useAlarms, type AlarmKind } from "./ui/Alarm";
import { MuteButton } from "./ui/Mute";
import { MyBoardView } from "./ui/MyBoard";

const TABS: [Tab, string, keyof typeof Icon][] = [
  ["live", "Live", "live"], ["board", "My board", "board"], ["appliances", "Appliances", "units"], ["stations", "Stations", "stations"],
  ["log", "Log", "log"],
];

function tabFromHash(): Tab {
  const h = typeof location !== "undefined" ? location.hash.slice(1) : "";
  if (h === "settings" || h === "data") return "data";
  if (h === "tv") return "board";
  return (TABS.find((t) => t[0] === h)?.[0]) ?? "live";
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [filter, setFilter] = useState<string>();
  const [sheet, setSheet] = useState<{ kind: "station" | "appliance"; id: string } | null>(null);
  const conn = useStore((s) => s.connection);
  const mode = useStore((s) => s.settings.mode);
  const speed = useStore((s) => s.settings.sim.speed);
  const listening = useStore((s) => s.input?.status === "listening");
  const hasPlayer = useStore((s) => s.settings.mode === "file" && !!s.player && (s.player.duration > 0 || s.player.decoding !== null));
  const { board, events, ix } = useBoard();
  useAlerts(events);
  const alarm = useAlarms(events, ix);
  useEffect(() => {
    const test = (e: Event) => alarm.test(((e as CustomEvent).detail as AlarmKind) ?? "turnout");
    window.addEventListener("tb-test-alarm", test);
    return () => window.removeEventListener("tb-test-alarm", test);
  }, [alarm]);
  useEffect(() => {
    const unlock = () => unlockAlertAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
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
    try { history.replaceState(null, "", `#${t === "data" ? "settings" : t}`); } catch { /* sandboxed */ }
    window.scrollTo({ top: 0 });
  }, []);
  const nav: Nav = {
    tab: go,
    station: (id) => setSheet({ kind: "station", id }),
    appliance: (id) => setSheet({ kind: "appliance", id }),
  };

  const connLabel = mode === "demo" ? `Demo · ${speed}×` : mode === "file" ? "Recording" : mode === "input" ? (listening ? "Listening" : "Input off") : { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", error: "Offline", demo: "Demo", file: "Recording", input: "Input" }[conn.status];

  return (
    <div className={`shell${hasPlayer ? " has-player" : ""}`}>
      <header className="top">
        <h1 className="brand">Auckland Turnouts</h1>
        <span className="spacer" />
        <button className={`conn ${mode === "backend" ? conn.status : mode === "input" && listening ? "live" : "demo"}`} onClick={() => go("data", "source")} title="Data source">
          <i />{connLabel}
        </button>
        <span className="clock"><b>{clockTime(now)}</b></span>
        <MuteButton />
        <button className={`gear${tab === "data" ? " on" : ""}`} onClick={() => go("data")} aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
          {board.inbox.length > 0 && <span className="badge">{board.inbox.length}</span>}
        </button>
      </header>
      <nav className="tabbar" aria-label="Sections">
        {TABS.map(([key, label, icon]) => (
          <button key={key} aria-current={tab === key ? "page" : undefined} onClick={() => go(key)}>
            {Icon[icon]}<span>{label}</span>
          </button>
        ))}
      </nav>
      <main className="main" key={`${tab}:${filter ?? ""}`}>
        {tab === "live" && <LiveView nav={nav} />}
        {tab === "board" && <MyBoardView nav={nav} />}
        {tab === "appliances" && <AppliancesView nav={nav} filter={filter} />}
        {tab === "stations" && <StationsView nav={nav} />}
        {tab === "log" && <LogView nav={nav} filter={filter} />}
        {tab === "data" && <DataView sub={filter} />}
      </main>
      <PlayerBar />
      <AlarmOverlay hits={alarm.hits} onAck={alarm.ack} ix={ix} />
      {sheet?.kind === "station" && <StationSheet id={sheet.id} nav={nav} onClose={() => setSheet(null)} />}
      {sheet?.kind === "appliance" && <ApplianceSheet id={sheet.id} nav={nav} onClose={() => setSheet(null)} />}
    </div>
  );
}
