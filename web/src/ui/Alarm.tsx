import { useEffect, useRef, useState } from "react";
import type { Index } from "../core/interpret";
import type { Interpreted } from "../core/types";
import { store, type AlarmSettings } from "../store";
import { clockTime } from "./common";
import { siren, stopSiren } from "./alerts";

export interface AlarmHit {
  ev: Interpreted;
  why: string; // e.g. "Grey Lynn 261" or "Grey Lynn station"
}

/** Does this turnout match the alarm's stations/trucks? */
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

/** Collect live turnouts that match the alarm; returns the active hits. */
export function useTurnoutAlarm(events: Interpreted[], ix: Index) {
  const [hits, setHits] = useState<AlarmHit[]>([]);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(events.map((e) => e.call.id)); return; }
    const cfg = store.get().settings.alarm;
    const fresh: AlarmHit[] = [];
    for (const ev of events) {
      if (seen.current.has(ev.call.id)) continue;
      seen.current.add(ev.call.id);
      if (Date.now() - ev.call.time > 15_000) continue; // backfilled history
      const why = alarmMatch(ev, cfg, ix);
      if (why) fresh.push({ ev, why });
    }
    if (fresh.length) setHits((h) => [...fresh.reverse(), ...h].slice(0, 8));
  }, [events, ix]);
  useEffect(() => {
    const off = store.subscribe(() => { if (store.get().calls.length === 0) seen.current = null; });
    return () => { off(); };
  }, []);
  return { hits, ack: () => setHits([]), test: () => setHits([testHit()]) };
}

function testHit(): AlarmHit {
  const now = Date.now();
  return {
    why: "Test alarm",
    ev: { call: { id: `test${now}`, time: now, code: "182261", kind: "station", confidence: 1, source: "test" },
          type: "turnout", label: "Turnout", title: "Test alarm" },
  };
}

/** Full-screen turnout alarm. Sounds (and repeats) until acknowledged. */
export function AlarmOverlay({ hits, onAck }: { hits: AlarmHit[]; onAck: () => void }) {
  const active = hits.length > 0;
  const latest = hits[0];
  useEffect(() => {
    if (!active) return;
    const { sound, repeat } = store.get().settings.alarm;
    if (sound) siren(repeat);
    try { navigator.vibrate?.([600, 200, 600, 200, 600, 200, 600]); } catch { /* none */ }
    try {
      if (store.get().settings.alerts.notify && document.hidden && Notification.permission === "granted") {
        new Notification("TURNOUT", { body: latest.why, tag: "turnout-alarm", requireInteraction: true });
      }
    } catch { /* not available */ }
    return () => stopSiren();
  }, [active, latest?.ev.call.id]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") onAck(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onAck]);
  if (!active) return null;
  return (
    <div className="alarm" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div className="alarm-inner">
        <div className="alarm-kicker">{latest.ev.type === "station-turnout" ? "Station call" : "Turnout"}</div>
        <h2 id="alarm-title" className="alarm-title">{latest.why}</h2>
        <div className="alarm-meta"><span className="mono">{latest.ev.call.code}</span> · {clockTime(latest.ev.call.time)}</div>
        {hits.length > 1 && (
          <ul className="alarm-more">
            {hits.slice(1).map((h) => <li key={h.ev.call.id}>{h.why} <span className="mono">{clockTime(h.ev.call.time)}</span></li>)}
          </ul>
        )}
        <button className="alarm-ack" onClick={onAck} autoFocus>Acknowledge</button>
      </div>
    </div>
  );
}
