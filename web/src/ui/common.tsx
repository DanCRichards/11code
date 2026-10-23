import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NAMES, TONES, type Slot } from "../decoder/selcall";
import { deriveBoard, stateText } from "../core/derive";
import { buildIndex, interpretAll } from "../core/interpret";
import type { ApplianceState, Interpreted } from "../core/types";
import { useStore } from "../store";

export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Codebook index, interpreted log and derived board, kept in sync. */
export function useBoard() {
  const codebook = useStore((s) => s.codebook);
  const calls = useStore((s) => s.calls);
  const dismissed = useStore((s) => s.settings.dismissed);
  const now = useNow(5000);
  const ix = useMemo(() => buildIndex(codebook), [codebook]);
  const events = useMemo(() => interpretAll(calls, ix), [calls, ix]);
  const board = useMemo(() => deriveBoard(events, ix, now, new Set(dismissed)), [events, ix, now, dismissed]);
  return { codebook, ix, events, board, now };
}

const timeFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const shortFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const clockTime = (t: number) => timeFmt.format(t);
export const shortTime = (t: number) => shortFmt.format(t);
export const dateTime = (t: number) => dateFmt.format(t);

export function ago(t: number | undefined, now: number): string {
  if (!t) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return dateTime(t);
}

export const stateVar = (s: ApplianceState) => `var(--${{
  "turned-out": "s-out", responding: "s-resp", "at-incident": "s-scene", "out-of-area": "s-ooa",
  "available-radio": "s-radio", "on-station": "s-station", "status-unknown": "s-unknown", "not-heard": "s-notheard",
}[s]})`;

export function StatePill({ state }: { state: ApplianceState }) {
  return <span className={`pill st-${state}`}>{stateText(state)}</span>;
}

export function EventPill({ ev }: { ev: Interpreted }) {
  const label = ev.type === "status" && ev.state ? stateText(ev.state) : ev.label;
  const cls = ev.type === "status" && ev.state ? `st-${ev.state}` : `ev-${ev.type}`;
  return <span className={`pill ${cls}`}>{label}</span>;
}

const toneHue = (f: number) => 205 - ((f - 930) / (2400 - 930)) * 185;

/** The tones the decoder read in each slot, grouped by message part. */
export function ToneStrip({ slots, long }: { slots: Slot[]; long: boolean }) {
  const groups: [string, number, number][] = long
    ? [["Unit ID", 0, 5], ["Sep", 5, 6], ["Message", 6, slots.length]]
    : [["Code", 0, 5], ["Final", 5, 6]];
  return (
    <div className="strip">
      {groups.map(([name, a, b]) => (
        <div className="tgroup" key={name}>
          <div>
            {slots.slice(a, b).map(([lab, cov], j) => {
              const t = lab >= 0 ? NAMES[lab] : "?";
              const f = lab >= 0 ? TONES[t] : 0;
              return (
                <div key={j} className={`slot${long && a + j === 5 ? " sep" : ""}`}
                  title={`${t} ${f ? f + " Hz" : ""} · ${Math.round(cov * 100)}% of slot`}
                  style={{ background: f ? `hsl(${toneHue(f)} 62% 40%)` : undefined, opacity: 0.35 + 0.65 * cov }}>
                  <b>{t}</b><span>{f || "–"}</span>
                </div>
              );
            })}
          </div>
          <span>{name}</span>
        </div>
      ))}
    </div>
  );
}

export function Sheet({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <div className="grow">
            <h2>{title}</h2>
            {sub && <div className="muted small">{sub}</div>}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </section>
    </>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export const Icon = {
  board: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>,
  live: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="2.5" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" /></svg>,
  units: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M2 16V9h11l3 3h4a2 2 0 0 1 2 2v2H2z" /><circle cx="7" cy="17.5" r="2" /><circle cx="17" cy="17.5" r="2" /><path d="M4 6h8" /></svg>,
  stations: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 21V10l9-6 9 6v11z" /><path d="M8 21v-6h8v6M12 4v3" /></svg>,
  log: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></svg>,
  data: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>,
};
