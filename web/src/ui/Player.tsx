import { useEffect, useMemo, useRef, useState } from "react";
import { interpret } from "../core/interpret";
import type { Interpreted } from "../core/types";
import { fileActions } from "../sources/controller";
import { useStore, type Player } from "../store";
import { EventPill, stateVar, useBoard } from "./common";

const ACCEPT = "audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.mp4,.mov,.webm";

export const fmt = (s: number) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

function markerColour(ev: Interpreted): string {
  if (ev.type === "turnout") return "var(--s-out)";
  if (ev.type === "station-ack") return "var(--s-station)";
  if (ev.type === "priority") return "var(--hivis)";
  if (ev.type === "status" && ev.state) return stateVar(ev.state);
  return "var(--s-unknown)";
}

/** The found calls, interpreted with the current codebook. */
function useFound(p?: Player) {
  const { ix } = useBoard();
  return useMemo(() => (p?.found ?? []).map((f) => ({ offset: f.offset, ev: interpret(f.call, ix) })), [p?.found, ix]);
}

/** Pick a file by button or drag-and-drop; also offers a generated sample. */
export function ImportPanel({ compact }: { compact?: boolean }) {
  const p = useStore((s) => s.player);
  const mode = useStore((s) => s.settings.mode);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const found = useFound(p);
  const pick = (f?: File) => { if (f) void fileActions.open(f); };

  return (
    <section className={`panel import${over ? " over" : ""}`} aria-label="Decode a recording"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}>
      <h2>Decode a recording <small>{mode === "file" && p ? p.name : "audio or video, stays on your device"}</small></h2>
      <input ref={input} type="file" accept={ACCEPT} hidden id="audio-file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="row">
        <button className="btn primary" onClick={() => input.current?.click()}>{mode === "file" && p ? "Open another file" : "Choose a file"}</button>
        <button className="btn" onClick={() => void fileActions.open()}>Try a generated sample</button>
        {mode === "file" && <button className="btn" onClick={() => fileActions.close()}>Back to demo</button>}
      </div>
      {!compact && <p className="note">Drop a scanner recording or phone video here. It's decoded in your browser, then plays back with each call appearing on the board as you hear it.</p>}
      {p?.decoding !== null && p?.decoding !== undefined && (
        <div className="grid-gap">
          <div className="small">Decoding… {Math.round(p.decoding * 100)}%</div>
          <div className="meter"><i style={{ width: `${Math.round(p.decoding * 100)}%` }} /></div>
        </div>
      )}
      {p?.error && <p className="error">{p.error}</p>}
      {mode === "file" && p && p.decoding === null && !p.error && (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small"><b>{found.filter((f) => f.ev.type !== "unreadable").length}</b> calls in {fmt(p.duration)}
              {found.some((f) => f.ev.type === "unreadable") && <span className="muted"> · {found.filter((f) => f.ev.type === "unreadable").length} too noisy to read</span>}</span>
            <div className="seg" role="group" aria-label="When calls appear">
              <button aria-pressed={p.reveal === "play"} onClick={() => fileActions.reveal("play")}>As it plays</button>
              <button aria-pressed={p.reveal === "all"} onClick={() => fileActions.reveal("all")}>All now</button>
            </div>
          </div>
          {found.length === 0 ? <p className="empty">No SelCall tones found in this recording.</p> : (
            <ul className="list">
              {found.map(({ offset, ev }) => (
                <li key={ev.call.id}>
                  <button className={`item${offset <= p.position + 0.05 && p.position - offset < 2 ? " fresh" : ""}`} onClick={() => fileActions.playFrom(Math.max(0, offset - 0.4))}
                    style={{ opacity: p.reveal === "play" && offset > p.position + 0.05 ? 0.55 : 1 }}>
                    <span className="t">{fmt(offset)}</span>
                    <span className="what"><b>{ev.title}</b><span><code>{ev.call.code || "—"}</code> · {Math.round(ev.call.confidence * 100)}%</span></span>
                    <EventPill ev={ev} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Docked playback bar with a waveform scrubber and call markers. */
export function PlayerBar() {
  const p = useStore((s) => s.player);
  const mode = useStore((s) => s.settings.mode);
  const found = useFound(p);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !p) return;
    const draw = () => {
      const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!w || !h) return;
      c.width = w * dpr; c.height = h * dpr;
      const g = c.getContext("2d")!;
      g.scale(dpr, dpr);
      const css = getComputedStyle(c);
      const col = (v: string) => css.getPropertyValue(v).trim() || "#888";
      const played = p.duration ? p.position / p.duration : 0;
      const n = p.envelope.length;
      const bw = w / Math.max(1, n);
      for (let i = 0; i < n; i++) {
        const bh = Math.max(1, p.envelope[i] * (h - 14));
        g.fillStyle = i / n <= played ? col("--ink") : col("--s-notheard");
        g.fillRect(i * bw, (h - 6 - bh) / 2 + 6, Math.max(1, bw - 0.5), bh);
      }
      for (const f of found) {
        const x = (f.offset / p.duration) * w;
        const m = markerColour(f.ev);
        g.fillStyle = m.startsWith("var(") ? col(m.slice(4, -1)) : m;
        g.fillRect(x - 1.5, 0, 3, 7);
      }
      g.fillStyle = col("--accent");
      g.fillRect(played * w - 1, 0, 2, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [p, found]);

  if (mode !== "file" || !p || (p.duration === 0 && p.decoding === null)) return null;
  const ready = p.decoding === null && p.duration > 0;
  const seekAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    fileActions.seek(((clientX - r.left) / r.width) * p.duration);
  };
  const next = found.find((f) => f.offset > p.position + 0.1);

  return (
    <div className="playerbar" role="region" aria-label="Recording player">
      <button className="play" onClick={() => fileActions.toggle()} disabled={!ready} aria-label={p.playing ? "Pause" : "Play"}>
        {p.playing
          ? <svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
          : <svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></svg>}
      </button>
      <div className="pb-main">
        <div className="pb-top">
          <span className="pb-name">{ready ? p.name : `Decoding ${p.name}… ${Math.round((p.decoding ?? 0) * 100)}%`}</span>
          <span className="mono small">{fmt(p.position)} / {fmt(p.duration)}</span>
        </div>
        <canvas ref={canvas} className="scrub" aria-label="Seek"
          onPointerDown={(e) => { if (!ready) return; drag.current = true; (e.target as Element).setPointerCapture(e.pointerId); seekAt(e.clientX); }}
          onPointerMove={(e) => { if (drag.current) seekAt(e.clientX); }}
          onPointerUp={() => { drag.current = false; }} />
      </div>
      <button className="skip" disabled={!ready || !next} onClick={() => next && fileActions.playFrom(Math.max(0, next.offset - 0.4))}
        title="Jump to the next call" aria-label="Jump to the next call">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 5v14l9-7zM15 5h3v14h-3z" fill="currentColor" /></svg>
      </button>
    </div>
  );
}
