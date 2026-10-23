import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import geo from "../data/geo.json";
import type { Board } from "../core/derive";
import { isCommitted } from "../core/derive";
import type { Index } from "../core/interpret";
import { ago, stateVar } from "./common";

const project = (lat: number, lon: number) => ({
  x: (lon - geo.lon0) * geo.k * geo.scale,
  y: (geo.lat1 - lat) * geo.scale,
});

const PRESETS = {
  central: { ...project(-36.872, 174.765), span: 820 },
  region: { x: geo.width / 2, y: geo.height / 2, span: 2050 },
};
const WATER: [string, number, number][] = [
  ["Waitematā Harbour", -36.836, 174.700], ["Hauraki Gulf", -36.735, 174.84],
  ["Manukau Harbour", -37.0, 174.66], ["Tāmaki Estuary", -36.893, 174.872],
];
// Label side for stations whose neighbours would otherwise collide.
const LABEL_SIDE: Record<string, "l" | "t" | "b"> = {
  "auckland-city": "t", parnell: "b", "grey-lynn": "l", avondale: "l", "mt-roskill": "l", birkenhead: "l",
  greenhithe: "l", "glen-eden": "l", henderson: "l", "west-harbour": "l", "st-heliers": "b", "mt-wellington": "b",
  titirangi: "l", muriwai: "b", mangere: "l",
};

interface View { x: number; y: number; span: number }

/** The central preset, zoomed in further on small screens so names fit. */
const centralFor = (w: number, h: number): View => ({ ...PRESETS.central, span: Math.min(PRESETS.central.span, Math.min(w, h) * 1.75) });

export function MapView({ board, ix, recentMs, now, selected, onSelect }: {
  board: Board; ix: Index; recentMs: number; now: number; selected?: string; onSelect: (stationId: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 400 });
  const [view, setView] = useState<View>(PRESETS.central);
  const fitted = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; dist?: number; mid?: { x: number; y: number }; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || 400, h = el.clientHeight || 400;
      setSize({ w, h });
      if (!fitted.current) { fitted.current = true; setView(centralFor(w, h)); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const upp = view.span / Math.min(size.w, size.h); // map units per CSS pixel
  const vb = { x: view.x - (size.w / 2) * upp, y: view.y - (size.h / 2) * upp, w: size.w * upp, h: size.h * upp };

  const clamp = useCallback((v: View): View => ({
    span: Math.min(2400, Math.max(110, v.span)),
    x: Math.min(geo.width, Math.max(0, v.x)),
    y: Math.min(geo.height, Math.max(0, v.y)),
  }), []);

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    setView((v) => {
      const u = v.span / Math.min(size.w, size.h);
      const ox = (px ?? size.w / 2) - size.w / 2, oy = (py ?? size.h / 2) - size.h / 2;
      const span = Math.min(2400, Math.max(110, v.span * factor));
      const u2 = span / Math.min(size.w, size.h);
      return clamp({ span, x: v.x + ox * u - ox * u2, y: v.y + oy * u - oy * u2 });
    });
  }, [size, clamp]);

  useEffect(() => {
    const el = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { view, moved: false, ...pinchInfo() };
  };
  const pinchInfo = () => {
    const p = [...pointers.current.values()];
    if (p.length < 2) return {};
    return { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mid: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } };
  };
  const start = useRef<{ x: number; y: number } | null>(null);
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const prev = pointers.current.get(e.pointerId)!;
    if (!start.current) start.current = prev;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const u0 = g.view.span / Math.min(size.w, size.h);
    if (pointers.current.size >= 2 && g.dist && g.mid) {
      const { dist, mid } = pinchInfo() as { dist: number; mid: { x: number; y: number } };
      const span = Math.min(2400, Math.max(110, g.view.span * (g.dist / dist)));
      const u1 = span / Math.min(size.w, size.h);
      const r = wrap.current!.getBoundingClientRect();
      const ox0 = g.mid.x - r.left - size.w / 2, oy0 = g.mid.y - r.top - size.h / 2;
      const ox1 = mid.x - r.left - size.w / 2, oy1 = mid.y - r.top - size.h / 2;
      g.moved = true;
      setView(clamp({ span, x: g.view.x + ox0 * u0 - ox1 * u1, y: g.view.y + oy0 * u0 - oy1 * u1 }));
    } else {
      const s = start.current!;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        g.moved = true;
        // Capture only once it's a drag, so a plain tap still reaches the station.
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }
      if (g.moved) setView(clamp({ ...g.view, x: g.view.x - dx * u0, y: g.view.y - dy * u0 }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    start.current = null;
    if (pointers.current.size === 0) setTimeout(() => { gesture.current = null; }, 0);
    else gesture.current = { view, moved: true, ...pinchInfo() };
  };
  const tap = (id: string) => { if (!gesture.current?.moved) onSelect(id); };

  const zoomedIn = upp < 1.9;
  const stations = [...ix.station.values()].map((s) => {
    const p = project(s.lat, s.lon);
    const sb = board.stations.get(s.id)!;
    const age = sb.lastTurnout ? now - sb.lastTurnout : Infinity;
    const out = [...ix.appliance.values()].filter((a) => a.stationId === s.id)
      .map((a) => ({ a, st: board.appliances.get(a.id)!.state }))
      .filter((x) => isCommitted(x.st));
    return { s, p, sb, recent: age < recentMs, fresh: age < recentMs / 4, out };
  }).sort((a, b) => Number(a.recent) - Number(b.recent));

  return (
    <div className="mapcard">
      <div className="mapbar">
        <div className="seg" role="group" aria-label="Map view">
          <button aria-pressed={view.span === centralFor(size.w, size.h).span && view.x === PRESETS.central.x} onClick={() => setView(centralFor(size.w, size.h))}>Central</button>
          <button aria-pressed={view.span === PRESETS.region.span && view.x === PRESETS.region.x} onClick={() => setView(PRESETS.region)}>Region</button>
        </div>
        <span className="muted small">Stations light up when turned out. Incident locations aren't sent.</span>
      </div>
      <div className="mapwrap" ref={wrap}>
        <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          role="img" aria-label="Map of Auckland fire stations">
          <rect x={-4000} y={-4000} width={10000} height={10000} fill="var(--sea)" />
          <path className="land" d={geo.land} />
          {WATER.map(([t, lat, lon]) => {
            const p = project(lat, lon);
            return <text key={t} className="water" x={p.x} y={p.y} fontSize={12 * upp} textAnchor="middle">{t}</text>;
          })}
          {stations.map(({ s, p, sb, recent, fresh, out }) => {
            const side = LABEL_SIDE[s.id] ?? "r";
            const lp = { r: [9, 4, "start"], l: [-9, 4, "end"], t: [0, -10, "middle"], b: [0, 17, "middle"] }[side] as [number, number, "start" | "end" | "middle"];
            const showLabel = zoomedIn || recent || selected === s.id;
            const dotDir = side === "l" ? 1 : -1;
            return (
              <g key={s.id} className={`stn${recent ? " recent" : ""}${selected === s.id ? " sel" : ""}`}
                transform={`translate(${p.x} ${p.y}) scale(${upp})`}
                onClick={() => tap(s.id)} role="button" tabIndex={0} aria-label={`${s.name} station`}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.id); } }}>
                {fresh && <circle className="ring" r={6} />}
                <circle className="dot2" r={recent ? 6.5 : 5} />
                {out.map(({ a, st }, i) => (
                  <circle key={a.id} cx={dotDir * (11 + i * 7)} cy={0} r={3.2} fill={stateVar(st)} stroke="var(--land)" strokeWidth={1.2} />
                ))}
                {showLabel && (
                  <>
                    <text className="lbl" x={lp[0]} y={lp[1]} textAnchor={lp[2]}>{s.name}</text>
                    {recent && <text className="ago" x={lp[0]} y={lp[1] + 12} textAnchor={lp[2]}>{ago(sb.lastTurnout, now)}</text>}
                  </>
                )}
                <circle className="hit" r={14} />
              </g>
            );
          })}
        </svg>
        <div className="zoom">
          <button onClick={() => zoomAt(0.7)} aria-label="Zoom in">+</button>
          <button onClick={() => zoomAt(1 / 0.7)} aria-label="Zoom out">−</button>
        </div>
      </div>
      <div className="legend">
        <span><i className="dot" style={{ background: "var(--s-out)" }} />Turned out recently</span>
        <span><i className="dot" style={{ background: "var(--s-resp)" }} />Responding</span>
        <span><i className="dot" style={{ background: "var(--s-scene)" }} />At incident</span>
        <span><i className="dot" style={{ background: "var(--s-ooa)" }} />Out of area</span>
        <span className="muted">Coastline: GSHHS · positions approximate</span>
      </div>
    </div>
  );
}
