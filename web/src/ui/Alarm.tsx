import { useEffect, useRef, useState } from "react";
import type { Index } from "../core/interpret";
import type { Interpreted } from "../core/types";
import { store, type AlarmSettings, type PriorityAlarmSettings } from "../store";
import { clockTime } from "./common";
import { siren, stopSiren } from "./alerts";

export type AlarmKind = "turnout" | "priority";

export interface AlarmHit {
  kind: AlarmKind;
  ev: Interpreted;
  why: string; // e.g. "Grey Lynn 261" or "Grey Lynn station"
}

/** Does this turnout match the turnout alarm's stations/trucks? */
export function alarmMatch(ev: Interpreted, cfg: AlarmSettings, ix: Index): string | null {
  if (ev.type !== "turnout" && ev.type !== "station-turnout") return null;
  const sid = ev.stationId;
  if (!sid) return null;
  const sname = ix.station.get(sid)?.name ?? sid;
  if (ev.type === "turnout" && ev.applianceId) {
    if (cfg.appliances.includes(ev.applianceId) || cfg.stations.includes(sid)) return ev.title;
    return null;
  }
  // Whole-station call: alarm if the station, or any chosen truck there, is watched.
  const truckThere = cfg.appliances.some((id) => ix.appliance.get(id)?.stationId === sid);
  return cfg.stations.includes(sid) || truckThere ? `${sname} station` : null;
}

/** Does this priority call match the priority alarm (any truck, or chosen ones)? */
export function priorityMatch(ev: Interpreted, cfg: PriorityAlarmSettings): string | null {
  if (ev.type !== "priority" || cfg.scope === "off") return null;
  if (cfg.scope === "any") return ev.title;
  const chosen = (ev.applianceId && cfg.appliances.includes(ev.applianceId)) || (ev.stationId && cfg.stations.includes(ev.stationId));
  return chosen ? ev.title : null;
}

/** Collect live calls that set off an alarm; returns the active hits. */
export function useAlarms(events: Interpreted[], ix: Index) {
  const [hits, setHits] = useState<AlarmHit[]>([]);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(events.map((e) => e.call.id)); return; }
    const { alarm, priorityAlarm } = store.get().settings;
    const fresh: AlarmHit[] = [];
    for (const ev of events) {
      if (seen.current.has(ev.call.id)) continue;
      seen.current.add(ev.call.id);
      if (Date.now() - ev.call.time > 15_000) continue; // backfilled history
      const p = priorityMatch(ev, priorityAlarm);
      if (p) { fresh.push({ kind: "priority", ev, why: p }); continue; }
      const t = alarmMatch(ev, alarm, ix);
      if (t) fresh.push({ kind: "turnout", ev, why: t });
    }
    if (fresh.length) {
      store.alertUnmute();
      setHits((h) => [...fresh.reverse(), ...h].slice(0, 8));
    }
  }, [events, ix]);
  useEffect(() => {
    const off = store.subscribe(() => { if (store.get().calls.length === 0) seen.current = null; });
    return () => { off(); };
  }, []);
  return {
    hits,
    ack: () => setHits([]),
    test: (kind: AlarmKind) => { store.alertUnmute(); setHits([testHit(kind)]); },
  };
}

function testHit(kind: AlarmKind): AlarmHit {
  const now = Date.now();
  return {
    kind, why: "Test alarm",
    ev: { call: { id: `test${now}`, time: now, code: kind === "priority" ? "D72F1B" : "182261", kind: "station", confidence: 1, source: "test" },
          type: kind === "priority" ? "priority" : "turnout", label: kind === "priority" ? "Priority call" : "Turnout", title: "Test alarm" },
  };
}

/** Full-screen alarm. Sounds (and repeats) until acknowledged. Priority calls take precedence. */
export function AlarmOverlay({ hits, onAck }: { hits: AlarmHit[]; onAck: () => void }) {
  const active = hits.length > 0;
  const latest = hits.find((h) => h.kind === "priority") ?? hits[0];
  const unmutedUntil = useStore_unmutedUntil();
  useEffect(() => {
    if (!active) return;
    const { sound, repeat } = store.get().settings.alarm;
    if (sound) siren(repeat, latest.kind);
    try { navigator.vibrate?.(latest.kind === "priority" ? [250, 100, 250, 100, 250, 100, 250, 100, 250] : [600, 200, 600, 200, 600, 200, 600]); } catch { /* none */ }
    try {
      if (store.get().settings.alerts.notify && document.hidden && Notification.permission === "granted") {
        new Notification(latest.kind === "priority" ? "PRIORITY CALL" : "TURNOUT", { body: latest.why, tag: "alarm", requireInteraction: true });
      }
    } catch { /* not available */ }
    return () => stopSiren();
  }, [active, latest?.ev.call.id, latest?.kind]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") onAck(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onAck]);
  if (!active) return null;
  const others = hits.filter((h) => h !== latest);
  const kicker = latest.kind === "priority" ? "Priority call" : latest.ev.type === "station-turnout" ? "Station call" : "Turnout";
  return (
    <div className={`alarm ${latest.kind}`} role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div className="alarm-inner">
        <div className="alarm-kicker">{kicker}</div>
        <h2 id="alarm-title" className="alarm-title">{latest.why}</h2>
        <div className="alarm-meta"><span className="mono">{latest.ev.call.code}</span> · {clockTime(latest.ev.call.time)}</div>
        {others.length > 0 && (
          <ul className="alarm-more">
            {others.map((h) => <li key={h.ev.call.id}>{h.kind === "priority" ? "Priority: " : ""}{h.why} <span className="mono">{clockTime(h.ev.call.time)}</span></li>)}
          </ul>
        )}
        {unmutedUntil && <div className="alarm-meta">Radio audio un-muted for {Math.max(0, Math.ceil((unmutedUntil - Date.now()) / 1000))}s</div>}
        <button className="alarm-ack" onClick={onAck} autoFocus>Acknowledge</button>
      </div>
    </div>
  );
}

function useStore_unmutedUntil() {
  const [v, setV] = useState(store.get().unmutedUntil);
  useEffect(() => {
    const t = setInterval(() => setV(store.get().unmutedUntil), 1000);
    return () => clearInterval(t);
  }, []);
  return v;
}
