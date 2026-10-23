import { useEffect, useRef, useState } from "react";
import { STATE_LABEL } from "../core/derive";
import type { ApplianceState } from "../core/types";
import { store, useStore } from "../store";
import { ago, Seg, Sheet, stateVar, useBoard } from "./common";
import { useWindows } from "./LiveView";
import type { Nav } from "./nav";
import { UnitPicker } from "./Picker";

const LEGEND: ApplianceState[] = ["turned-out", "responding", "at-incident", "out-of-area", "available-radio", "on-station", "status-unknown", "not-heard"];

/** A custom grid of chosen trucks, grouped by station, coloured by status. */
export function MyBoardView({ nav }: { nav: Nav }) {
  const { ix, board, now } = useBoard();
  const cfg = useStore((s) => s.settings.myBoard);
  const { recentMs } = useWindows();
  const flashMs = recentMs / 7.5; // ~2 minutes at real speed
  const [editing, setEditing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const wake = useWakeLock();

  // Group chosen trucks by station, in the order the stations first appear.
  const groups: { stationId: string; ids: string[] }[] = [];
  for (const id of cfg.appliances) {
    const a = ix.appliance.get(id);
    if (!a) continue;
    let g = groups.find((x) => x.stationId === a.stationId);
    if (!g) groups.push((g = { stationId: a.stationId, ids: [] }));
    g.ids.push(id);
  }

  const fullscreen = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="page-title">My board</h1>
        <div className="row">
          <Seg label="Cell size" value={cfg.size} onChange={(v) => store.myBoard({ size: v })} options={[["large", "Large"], ["compact", "Compact"]]} />
          <button className="btn" onClick={() => setEditing(true)}>{cfg.appliances.length ? "Edit trucks" : "Choose trucks"}</button>
        </div>
      </div>

      {groups.length === 0 ? (
        <section className="panel">
          <p className="empty">Pick the trucks you want to keep an eye on: your local station, a few favourites, or a whole area. Each one gets a cell coloured by its status, and flashes when it's turned out.</p>
          <div className="row"><button className="btn primary" onClick={() => setEditing(true)}>Choose trucks</button></div>
        </section>
      ) : (
        <div ref={wrap} className={`myboard ${cfg.size}`}>
          <div className="mb-groups">
            {groups.map(({ stationId, ids }) => {
              const sb = board.stations.get(stationId);
              const called = sb?.history.find((e) => e.type === "station-turnout");
              const stationCalled = called && now - called.call.time < flashMs;
              return (
                <section key={stationId} className={`mb-station${stationCalled ? " called" : ""}`}>
                  <header>
                    <button className="linkbtn mb-sname" onClick={() => nav.station(stationId)}>{ix.station.get(stationId)?.name}</button>
                    {stationCalled
                      ? <span className="mb-called">Station called · {ago(called!.call.time, now)}</span>
                      : sb?.lastTurnout ? <span className="muted small">last turnout {ago(sb.lastTurnout, now)}</span> : null}
                  </header>
                  <div className="mb-cells">
                    {ids.map((id) => {
                      const a = ix.appliance.get(id)!;
                      const ab = board.appliances.get(id)!;
                      const own = ab.history.find((e) => e.type === "turnout");
                      const turnedOut = own && now - own.call.time < flashMs;
                      const priority = ab.priorityAt && now - ab.priorityAt < flashMs * 4;
                      return (
                        <button key={id} className={`mb-cell${turnedOut ? " flash" : ""}${stationCalled ? " pulse" : ""}${ab.state === "not-heard" ? " quiet" : ""}`}
                          style={{ ["--c" as string]: stateVar(ab.state) }} onClick={() => nav.appliance(id)}
                          aria-label={`${a.callsign} ${STATE_LABEL[ab.state]}`}>
                          <b>{a.callsign}</b>
                          <span className="mb-state">{turnedOut ? "Turnout" : STATE_LABEL[ab.state]}</span>
                          <span className="mb-ago">{ab.lastHeard ? ago(ab.lastHeard, now).replace(" ago", "") : "—"}{priority ? " · PRIORITY" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="mb-legend">
            {LEGEND.map((s) => <span key={s}><i style={{ background: stateVar(s) }} />{STATE_LABEL[s]}</span>)}
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="row">
          <button className="btn" onClick={fullscreen}>Full screen</button>
          <button className="btn" aria-pressed={wake.on} onClick={wake.toggle} disabled={!wake.supported}>{wake.supported ? "Keep screen on" : "Keep screen on (not supported here)"}</button>
        </div>
      )}

      {editing && (
        <Sheet title="Trucks on my board" sub={`${cfg.appliances.length} chosen`} onClose={() => setEditing(false)}>
          <UnitPicker stationMode="add-all" appliances={cfg.appliances} onChange={({ appliances }) => store.myBoard({ appliances })} />
          <div className="row">
            <button className="btn primary" onClick={() => setEditing(false)}>Done</button>
            {cfg.appliances.length > 0 && <button className="btn danger" onClick={() => store.myBoard({ appliances: [] })}>Clear all</button>}
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Screen Wake Lock, where the browser allows it. */
function useWakeLock() {
  type Sentinel = { release: () => Promise<void> };
  const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } };
  const supported = !!nav.wakeLock;
  const [on, setOn] = useState(false);
  const lock = useRef<Sentinel | null>(null);
  const acquire = async () => {
    try { lock.current = await nav.wakeLock!.request("screen"); setOn(true); } catch { setOn(false); }
  };
  useEffect(() => {
    // The lock drops when the tab is hidden; take it again on return.
    const onVis = () => { if (on && document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  });
  useEffect(() => () => { void lock.current?.release().catch(() => {}); }, []);
  return {
    supported, on,
    toggle: () => {
      if (on) { void lock.current?.release().catch(() => {}); lock.current = null; setOn(false); }
      else void acquire();
    },
  };
}
