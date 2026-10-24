import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { boardParts, boardText, stateText, type Board } from "../core/derive";
import type { Index } from "../core/interpret";
import type { ApplianceState } from "../core/types";
import { store, useStore } from "../store";
import { ago, Seg, Sheet, stateVar, useBoard } from "./common";
import { useWindows } from "./LiveView";
import type { Nav } from "./nav";
import { KCodePicker } from "./KCodePicker";
import { UnitPicker } from "./Picker";

const LEGEND: ApplianceState[] = ["turned-out", "responding", "at-incident", "out-of-area", "available-radio", "on-station", "status-unknown", "not-heard"];

/** Chosen trucks grouped by station, in the order each station was first added. */
function groupByStation(appliances: string[], ix: Index) {
  const groups: { stationId: string; ids: string[] }[] = [];
  for (const id of appliances) {
    const a = ix.appliance.get(id);
    if (!a) continue;
    let g = groups.find((x) => x.stationId === a.stationId);
    if (!g) groups.push((g = { stationId: a.stationId, ids: [] }));
    g.ids.push(id);
  }
  return groups;
}

/** One station's card: its name, when it was last turned out, and a cell per truck.
 *  The same card is used on the board and (scaled up) in TV mode. */
function StationCard({ stationId, ids, flashMs, onTruck, onStation, style }: {
  stationId: string; ids: string[]; flashMs: number; onTruck: (id: string) => void; onStation?: () => void; style?: CSSProperties;
}) {
  const { ix, board, now } = useBoard();
  const sb = board.stations.get(stationId);
  const turnedOutAt = sb?.lastTurnout && now - sb.lastTurnout < flashMs ? sb.lastTurnout : undefined;
  const name = ix.station.get(stationId)?.name;
  return (
    <section className={`mb-station${turnedOutAt ? " called" : ""}`} style={{ ["--n" as string]: Math.min(ids.length, 4), ...style }}>
      <header>
        {onStation ? <button className="linkbtn mb-sname" onClick={onStation}>{name}</button> : <span className="mb-sname">{name}</span>}
        {turnedOutAt ? <span className="mb-called">Turned out · {ago(turnedOutAt, now)}</span>
          : sb?.lastTurnout ? <span className="mb-last">last turnout {ago(sb.lastTurnout, now)}</span> : null}
      </header>
      <div className="mb-cells">
        {ids.map((id) => {
          const a = ix.appliance.get(id)!;
          const ab = board.appliances.get(id)!;
          const own = ab.history.find((e) => e.type === "turnout");
          const turnedOut = !!own && now - own.call.time < flashMs;
          const priority = !!ab.priorityAt && now - ab.priorityAt < flashMs * 4;
          return (
            <button key={id} className={`mb-cell${turnedOut ? " flash" : ""}${ab.state === "not-heard" ? " quiet" : ""}`}
              style={{ ["--c" as string]: stateVar(ab.state) }} onClick={() => onTruck(id)}
              aria-label={`${a.callsign} ${boardText(ab)}`}>
              <b>{a.callsign}</b>
              <StateLine parts={turnedOut ? { code: "T/O", label: "Turnout" } : priority ? { code: "PRI", label: "Priority call" } : boardParts(ab)} />
              <span className="mb-ago">{ab.lastHeard ? ago(ab.lastHeard, now).replace(" ago", "") : "—"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** "[K99] Well-involved fire": the chip carries the status colour (from the cell's --c). */
function StateLine({ parts }: { parts: { code: string; label: string } }) {
  return <span className="mb-state"><i className="kchip">{parts.code}</i><span>{parts.label}</span></span>;
}

/** Your boards: each a set of trucks grouped by station, coloured by status. */
export function MyBoardView({ nav }: { nav: Nav }) {
  const { ix, board } = useBoard();
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
  const groups = groupByStation(cfg.appliances, ix);
  const current = cfg.boards.find((b) => b.id === cfg.active);

  const fullscreen = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };
  const newBoard = () => { store.addBoard(`Board ${cfg.boards.length + 1}`); setEditing(true); };

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="page-title">{current?.name ?? "My board"}</h1>
        <div className="row">
          {cfg.appliances.length > 0 && <button className="btn primary" onClick={() => setTv(true)}>TV mode</button>}
          <Seg label="Cell size" value={cfg.size} onChange={(v) => store.myBoard({ size: v })} options={[["large", "Large"], ["compact", "Compact"]]} />
          <button className="btn" onClick={() => setEditing(true)}>{cfg.appliances.length ? "Edit board" : "Choose trucks"}</button>
        </div>
      </div>
      <div className="boards-bar" role="tablist" aria-label="Boards">
        {cfg.boards.map((b) => (
          <button key={b.id} role="tab" aria-selected={b.id === cfg.active} className={`board-tab${b.id === cfg.active ? " on" : ""}`} onClick={() => store.showBoard(b.id)}>
            {b.name}<span>{b.appliances.length}</span>
          </button>
        ))}
        <button className="board-tab add" onClick={newBoard}>+ New board</button>
      </div>

      {groups.length === 0 ? (
        <section className="panel">
          <p className="empty">No trucks on this board.</p>
          <div className="row"><button className="btn primary" onClick={() => setEditing(true)}>Add trucks</button></div>
        </section>
      ) : (
        <div ref={wrap} className={`myboard ${cfg.size}`}>
          <Legend states={LEGEND} counts={countStates(cfg.appliances, board)} className="mb-legend" />
          <div className="mb-groups">
            {groups.map(({ stationId, ids }) => (
              <StationCard key={stationId} stationId={stationId} ids={ids} flashMs={flashMs} onTruck={nav.appliance} onStation={() => nav.station(stationId)} />
            ))}
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
      {editing && current && (
        <Sheet title="Edit board" sub={`${cfg.appliances.length} truck${cfg.appliances.length === 1 ? "" : "s"}`} onClose={() => setEditing(false)}>
          <label className="field"><span>Board name</span>
            <input value={current.name} onChange={(e) => store.renameBoard(current.id, e.target.value)} placeholder="e.g. Central, North Shore" />
          </label>
          <UnitPicker stationMode="add-all" appliances={cfg.appliances} onChange={({ appliances }) => store.myBoard({ appliances })} />
          <div className="row">
            <button className="btn primary" onClick={() => setEditing(false)}>Done</button>
            {cfg.appliances.length > 0 && <button className="btn" onClick={() => store.myBoard({ appliances: [] })}>Clear trucks</button>}
            {cfg.boards.length > 1 && <button className="btn danger" onClick={() => { store.deleteBoard(current.id); setEditing(false); }}>Delete this board</button>}
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

/** Phone-sized TV mode: each station card is full width with up to two cells per row, and the page scrolls. */
export function scrollFit(counts: number[], w: number): ClusterFit {
  const cols = counts.map((n) => Math.min(Math.max(1, n), 2));
  // card width = 2 cells + 1 inner gap + 2 paddings, where gap and padding are 0.08 × cell height
  const th = Math.min(150, Math.floor(w / (1.3 * 2 + 0.08 * 3)));
  return { th, tw: Math.floor(th * 1.3), cols };
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

  const clusters = groupByStation(cfg.appliances, ix);
  const ids = clusters.flatMap((c) => c.ids);
  const called = clusters.map((c) => ({ sid: c.stationId, at: board.stations.get(c.stationId)?.lastTurnout }))
    .filter((c) => c.at && now - c.at < flashMs);
  // On a phone everything-on-one-screen makes tiles tiny, so scroll with usable cells instead.
  const narrow = box.w < 700;
  const fit = narrow ? scrollFit(clusters.map((c) => c.ids.length), box.w) : fitClusters(clusters.map((c) => c.ids.length), box.w, box.h, 14);
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicking(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);
  const boardName = cfg.boards.find((b) => b.id === cfg.active)?.name;

  return (
    <div className={`tv${narrow ? " narrow" : ""}`} role="region" aria-label="TV board">
      <header className="tv-top">
        {called.length > 0
          ? <span className="tv-called">Turned out: {called.map((c) => ix.station.get(c.sid)?.name).join(" · ")}</span>
          : <span className="tv-quiet">{cfg.boards.length > 1 && boardName ? `${boardName} · ` : ""}{ids.filter((id) => board.appliances.get(id)!.state !== "on-station" && board.appliances.get(id)!.state !== "not-heard").length} of {ids.length} trucks out</span>}
        <span className="tv-clock">{new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)}</span>
      </header>
      <div ref={area} className="tv-area" style={{ ["--th" as string]: `${fit.th}px`, ["--tw" as string]: `${fit.tw}px` }}>
        {ids.length === 0 && <p className="tv-empty">Choose trucks for this board first.</p>}
        {clusters.map((c, ci) => (
          <StationCard key={c.stationId} stationId={c.stationId} ids={c.ids} flashMs={flashMs} onTruck={setPicking} style={{ ["--cols" as string]: fit.cols[ci] }} />
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
