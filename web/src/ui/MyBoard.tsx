import { useCallback, useEffect, useRef, useState } from "react";
import { boardText, stateText, type Board } from "../core/derive";
import type { ApplianceState } from "../core/types";
import { store, useStore } from "../store";
import { ago, Seg, Sheet, stateVar, useBoard } from "./common";
import { useWindows } from "./LiveView";
import type { Nav } from "./nav";
import { KCodePicker } from "./KCodePicker";
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
          <Legend states={LEGEND} counts={countStates(cfg.appliances, board)} className="mb-legend" />
          <div className="mb-groups">
            {groups.map(({ stationId, ids }) => {
              const sb = board.stations.get(stationId);
              const called = sb?.history.find((e) => e.type === "station-turnout");
              const stationCalled = called && now - called.call.time < flashMs;
              return (
                <section key={stationId} className={`mb-station${stationCalled ? " called" : ""}`} style={{ ["--n" as string]: Math.min(ids.length, 4) }}>
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

function countStates(ids: string[], board: Board) {
  const n = new Map<ApplianceState, number>();
  for (const id of ids) {
    const st = board.appliances.get(id)?.state;
    if (st) n.set(st, (n.get(st) ?? 0) + 1);
  }
  return n;
}

/** Colour key as filled chips, with how many trucks on the board are in each state. */
function Legend({ states, counts, className }: { states: ApplianceState[]; counts: Map<ApplianceState, number>; className: string }) {
  return (
    <div className={className} role="list" aria-label="Colour key">
      {states.map((s) => {
        const n = counts.get(s) ?? 0;
        return (
          <span key={s} role="listitem" className={`key${n ? "" : " none"}${s === "not-heard" ? " quiet" : ""}`} style={{ ["--c" as string]: stateVar(s) }}>
            {stateText(s)}<b>{n}</b>
          </span>
        );
      })}
    </div>
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

export interface ClusterFit { th: number; tw: number; cols: number[] }

/**
 * Biggest tiles that fit when each station is its own cluster (a header plus its trucks),
 * clusters flowing left to right and wrapping. `counts` is trucks per station.
 * Header height and padding scale with the tile so the whole thing shrinks together.
 */
export function fitClusters(counts: number[], w: number, h: number, gap = 14, aspect = 1.3): ClusterFit {
  const layout = (th: number) => {
    const tw = th * aspect, pad = th * 0.08, head = th * 0.3, inner = th * 0.08;
    const cols = counts.map((n) => Math.max(1, Math.min(n, Math.floor((w - 2 * pad + inner) / (tw + inner)))));
    let x = 0, lineH = 0, total = 0;
    counts.forEach((n, i) => {
      const cw = cols[i] * tw + (cols[i] - 1) * inner + 2 * pad;
      const ch = head + Math.ceil(n / cols[i]) * (th + inner) - inner + 2 * pad;
      if (x > 0 && x + cw > w) { total += lineH + gap; x = 0; lineH = 0; }
      x += cw + gap;
      lineH = Math.max(lineH, ch);
    });
    return { fits: total + lineH <= h && Math.max(...cols.map((c) => c * tw + (c - 1) * inner + 2 * pad)) <= w, tw, cols };
  };
  let lo = 20, hi = Math.max(21, h);
  for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (layout(mid).fits) lo = mid; else hi = mid; }
  const { tw, cols } = layout(lo);
  return { th: Math.floor(lo), tw: Math.floor(tw), cols };
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".tv-pick")) onExit(); };
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
  const clusters = order.map((sid) => ({ sid, ids: ids.filter((id) => ix.appliance.get(id)!.stationId === sid) }));
  const fit = fitClusters(clusters.map((c) => c.ids.length), box.w, box.h, 14);
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicking(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  return (
    <div className="tv" role="region" aria-label="TV board">
      <header className="tv-top">
        {called.length > 0
          ? <span className="tv-called">Station called: {called.map((c) => ix.station.get(c.sid)?.name).join(" · ")}</span>
          : <span className="tv-quiet">{ids.filter((id) => board.appliances.get(id)!.state !== "on-station" && board.appliances.get(id)!.state !== "not-heard").length} of {ids.length} trucks out</span>}
        <span className="tv-clock">{new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)}</span>
      </header>
      <div ref={area} className="tv-area" style={{ ["--th" as string]: `${fit.th}px`, ["--tw" as string]: `${fit.tw}px` }}>
        {ids.length === 0 && <p className="tv-empty">Choose trucks for My board first.</p>}
        {clusters.map((c, ci) => (
          <section key={c.sid} className={`tv-cluster${calledSet.has(c.sid) ? " called" : ""}`} style={{ ["--cols" as string]: fit.cols[ci] }}>
            <h3 className="tv-sname">{ix.station.get(c.sid)?.name}{calledSet.has(c.sid) && <span className="tv-scalled">Called</span>}</h3>
            <div className="tv-cells">
              {c.ids.map((id) => {
                const a = ix.appliance.get(id)!;
                const ab = board.appliances.get(id)!;
                const own = ab.history.find((e) => e.type === "turnout");
                const turnedOut = own && now - own.call.time < flashMs;
                const priority = ab.priorityAt && now - ab.priorityAt < flashMs * 4;
                return (
                  <button key={id} className={`tv-tile${turnedOut ? " flash" : ""}${calledSet.has(a.stationId) ? " pulse" : ""}${ab.state === "not-heard" ? " quiet" : ""}`}
                    style={{ ["--c" as string]: stateVar(ab.state) }} onClick={() => setPicking(id)} aria-label={`${a.callsign}: ${boardText(ab)}. Set K code`}>
                    <b className="tv-call">{a.callsign}</b>
                    <span className="tv-state">{turnedOut ? "Turnout" : priority ? "Priority call" : boardText(ab)}</span>
                    <span className="tv-ago">{ab.lastHeard ? ago(ab.lastHeard, now) : ""}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <Legend states={LEGEND.filter((s) => s !== "status-unknown")} counts={countStates(ids, board)} className="tv-legend" />
      {picking && (
        <div className="tv-pick" role="dialog" aria-modal="true" aria-label="Set K code" onClick={(e) => { if (e.target === e.currentTarget) setPicking(null); }}>
          <div className="tv-pick-box">
            <header>
              <h2>{ix.station.get(ix.appliance.get(picking)!.stationId)?.name} {ix.appliance.get(picking)!.callsign}</h2>
              <button className="tv-pick-x" onClick={() => setPicking(null)} aria-label="Close">×</button>
            </header>
            <KCodePicker big applianceId={picking} current={board.appliances.get(picking)?.status?.kCode} onDone={() => setPicking(null)} />
          </div>
        </div>
      )}
      <button className={`tv-exit${chrome ? "" : " hidden"}`} onClick={onExit}>Exit TV mode</button>
    </div>
  );
}
