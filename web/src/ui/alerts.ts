import { useEffect, useRef } from "react";
import type { Interpreted } from "../core/types";
import { store } from "../store";

let ctx: AudioContext | undefined;

/** Browsers only allow audio after a tap; grab a context on the first one. */
export function unlockAlertAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no audio */ }
}

/** Two-tone alert: hi-lo three times for priority, one soft pair otherwise. */
export function chime(kind: "priority" | "turnout") {
  if (!ctx) return;
  const [hi, lo, reps, gain] = kind === "priority" ? [1250, 880, 3, 0.22] : [988, 740, 1, 0.12];
  const t0 = ctx.currentTime + 0.02;
  for (let r = 0; r < reps; r++) {
    [hi, lo].forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      const t = t0 + r * 0.5 + i * 0.22;
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.02);
      g.gain.setValueAtTime(gain, t + 0.16);
      g.gain.linearRampToValueAtTime(0, t + 0.2);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.22);
    });
  }
}

export async function askNotifications(): Promise<boolean> {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function notify(title: string, body: string) {
  try {
    if (!store.get().settings.alerts.notify || !document.hidden) return;
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, tag: title });
  } catch { /* not available here */ }
}

/** Fire alerts for calls that arrive while the page is open (not for history). */
export function useAlerts(events: Interpreted[]) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) { // first run: everything already here is history
      seen.current = new Set(events.map((e) => e.call.id));
      return;
    }
    const { alerts, watched } = store.get().settings;
    for (const ev of events) {
      if (seen.current.has(ev.call.id)) continue;
      seen.current.add(ev.call.id);
      if (Date.now() - ev.call.time > 15_000) continue; // backfilled, not live
      if (ev.type === "priority") {
        if (alerts.prioritySound) chime("priority");
        try { navigator.vibrate?.([300, 120, 300, 120, 300]); } catch { /* no vibration */ }
        notify("Priority call", `${ev.title} · ${ev.call.code}`);
      } else if ((ev.type === "turnout" || ev.type === "station-turnout") && ev.stationId && watched.includes(ev.stationId)) {
        if (alerts.watchedSound) chime("turnout");
        try { navigator.vibrate?.(200); } catch { /* no vibration */ }
        notify("Turnout", ev.title);
      }
    }
  }, [events]);
  useEffect(() => {
    // A source switch replaces the log; treat what's loaded then as history.
    const off = store.subscribe(() => {
      if (store.get().calls.length === 0) seen.current = null;
    });
    return () => { off(); };
  }, []);
}

let sirenTimer: number | undefined;
let sirenUntil = 0;

/** Loud alternating turnout alarm; repeats (for up to 3 minutes) until stopSiren(). */
export function siren(repeat: boolean) {
  stopSiren();
  if (!ctx) return;
  const burst = () => {
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const t = t0 + i * 0.3;
      o.type = "square";
      o.frequency.setValueAtTime(i % 2 ? 780 : 1180, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.01);
      g.gain.setValueAtTime(0.16, t + 0.26);
      g.gain.linearRampToValueAtTime(0, t + 0.29);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.3);
    }
  };
  burst();
  if (repeat) {
    sirenUntil = Date.now() + 3 * 60_000;
    sirenTimer = window.setInterval(() => {
      if (Date.now() > sirenUntil) stopSiren(); else burst();
    }, 3200);
  }
}

export function stopSiren() {
  clearInterval(sirenTimer);
  sirenTimer = undefined;
}
