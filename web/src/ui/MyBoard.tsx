import { useCallback, useEffect, useRef, useState } from "react";
import { boardText, stateText } from "../core/derive";
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
  const [tv, setTv] = useState(() => typeof location !== "undefined" && location.hash === "#tv");
  const exitTv = useCallback(() => {
    setTv(false);
    try { if (location.hash === "#tv") history.replaceState(null, "", "#board"); } catch { /* sandboxed */ }
  }, []);
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
          {cfg.appliances.length > 0 && <button className="btn primary" onClick={() => setTv(true)}>TV mode</button>}
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
                          aria-label={`${a.callsign} ${boardText(ab)}`}>
                          <b>{a.callsign}</b>
                          <span className="mb-state">{turnedOut ? "Turnout" : boardText(ab)}</span>
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
            {LEGEND.map((s) => <span key={s}><i style={{ background: stateVar(s) }} />{stateText(s)}</span>)}
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="row">
          <button className="btn" onClick={fullscreen}>Full screen</button>
          <button className="btn" aria-pressed={wake.on} onClick={wake.toggle} disabled={!wake.supported}>{wake.supported ? "Keep screen on" : "Keep screen on (not supported here)"}</button>
        </div>
      )}

      {tv && <TvBoard onExit={exitTv} />}
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

/** Best grid for `n` tiles in a w×h box: the column count that gives the biggest tiles. */
export function fitGrid(n: number, w: number, h: number, gap = 12, aspect = 1.35): { cols: number; rows: number } {
  let best = { cols: 1, rows: n, size: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const tw = (w - gap * (cols - 1)) / cols, th = (h - gap * (rows - 1)) / rows;
    const size = Math.min(tw / aspect, th); // tile height if kept at ~aspect wide
    if (size > best.size) best = { cols, rows, size };
  }
  return { cols: best.cols, rows: best.rows };
}

/** Full-window board for a TV: every chosen truck as big as the screen allows. */
export function TvBoard({ onExit }: { onExit: () => void }) {
  const { ix, board, now } = useBoard();
  const cfg = useStore((s) => s.settings.myBoard);
  const { recentMs } = useWindows();
  const flashMs = recentMs / 7.5;
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1600, h: 800 });
  const [chrome, setChrome] = useState(true);
  useEffect(() => {
    const el = area.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    void document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey);
    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [onExit]);
  useEffect(() => { // hide the exit button after a few seconds without the mouse moving
    let t = setTimeout(() => setChrome(false), 4000);
    const show = () => { setChrome(true); clearTimeout(t); t = setTimeout(() => setChrome(false), 4000); };
    window.addEventListener("pointermove", show);
    window.addEventListener("pointerdown", show);
    return () => { clearTimeout(t); window.removeEventListener("pointermove", show); window.removeEventListener("pointerdown", show); };
  }, []);

  const ids = cfg.appliances.filter((id) => ix.appliance.has(id))
    .sort((a, b) => cfg.appliances.indexOf(a) - cfg.appliances.indexOf(b));
  // keep each station's trucks together, in the order stations were first added
  const order = [...new Set(ids.map((id) => ix.appliance.get(id)!.stationId))];
  ids.sort((a, b) => order.indexOf(ix.appliance.get(a)!.stationId) - order.indexOf(ix.appliance.get(b)!.stationId));
  const called = order.map((sid) => ({ sid, ev: board.stations.get(sid)?.history.find((e) => e.type === "station-turnout") }))
    .filter((c) => c.ev && now - c.ev.call.time < flashMs);
  const calledSet = new Set(called.map((c) => c.sid));
  const { cols } = fitGrid(Math.max(1, ids.length), box.w, box.h, 14);

  return (
    <div className="tv" role="region" aria-label="TV board">
      <header className="tv-top">
        <span className="tv-brand">Auckland Turnouts</span>
        {called.length > 0
          ? <span className="tv-called">Station called: {called.map((c) => ix.station.get(c.sid)?.name).join(" · ")}</span>
          : <span className="tv-quiet">{ids.filter((id) => board.appliances.get(id)!.state !== "on-station" && board.appliances.get(id)!.state !== "not-heard").length} of {ids.length} out</span>}
        <span className="tv-clock">{new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)}</span>
      </header>
      <div ref={area} className="tv-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {ids.length === 0 && <p className="tv-empty">Choose trucks for My board first.</p>}
        {ids.map((id) => {
          const a = ix.appliance.get(id)!;
          const ab = board.appliances.get(id)!;
          const own = ab.history.find((e) => e.type === "turnout");
          const turnedOut = own && now - own.call.time < flashMs;
          const priority = ab.priorityAt && now - ab.priorityAt < flashMs * 4;
          return (
            <div key={id} className={`tv-tile${turnedOut ? " flash" : ""}${calledSet.has(a.stationId) ? " pulse" : ""}${ab.state === "not-heard" ? " quiet" : ""}`}
              style={{ ["--c" as string]: stateVar(ab.state) }}>
              <span className="tv-station">{ix.station.get(a.stationId)?.name}</span>
              <b className="tv-call">{a.callsign}</b>
              <span className="tv-state">{turnedOut ? "Turnout" : priority ? "Priority call" : boardText(ab)}</span>
              <span className="tv-ago">{ab.lastHeard ? ago(ab.lastHeard, now) : ""}</span>
            </div>
          );
        })}
      </div>
      <footer className="tv-legend">
        {LEGEND.filter((s) => s !== "status-unknown").map((s) => <span key={s}><i style={{ background: stateVar(s) }} />{stateText(s)}</span>)}
      </footer>
      <button className={`tv-exit${chrome ? "" : " hidden"}`} onClick={onExit}>Exit TV mode</button>
    </div>
  );
}
