import { useEffect, useRef } from "react";
import type { Interpreted } from "../core/types";
import { store } from "../store";
import priorityAlarmUrl from "../assets/sounds/priority-alarm.mp3";
import priorityChimeUrl from "../assets/sounds/priority-chime.mp3";
import turnoutAlarmUrl from "../assets/sounds/turnout-alarm.mp3";
import turnoutChimeUrl from "../assets/sounds/turnout-chime.mp3";

let ctx: AudioContext | undefined;

type Sound = "priority-alarm" | "priority-chime" | "turnout-alarm" | "turnout-chime";
const SOUND_URLS: Record<Sound, string> = {
  "priority-alarm": priorityAlarmUrl, "priority-chime": priorityChimeUrl,
  "turnout-alarm": turnoutAlarmUrl, "turnout-chime": turnoutChimeUrl,
};
const buffers = new Map<Sound, Promise<AudioBuffer | null>>();
// Everything currently sounding, so a new chime or Acknowledge can cut it off.
const playing = new Set<AudioScheduledSourceNode>();
let chimeGen = 0;

function track(node: AudioScheduledSourceNode) {
  playing.add(node);
  node.onended = () => playing.delete(node);
}

function load(name: Sound): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p && ctx) {
    const c = ctx;
    p = fetch(SOUND_URLS[name]).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => null);
    buffers.set(name, p);
  }
  return p ?? Promise.resolve(null);
}

/** Browsers only allow audio after a tap; grab a context on the first one and load the alert sounds. */
export function unlockAlertAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    (Object.keys(SOUND_URLS) as Sound[]).forEach((n) => void load(n));
  } catch { /* no audio */ }
}

/** Play a sound; resolves to a stop function, or null if it couldn't load. */
async function play(name: Sound, loop: boolean): Promise<(() => void) | null> {
  const buf = await load(name);
  if (!buf || !ctx) return null;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf;
  src.loop = loop;
  g.gain.value = 0.9;
  src.connect(g).connect(ctx.destination);
  track(src);
  src.start();
  return () => { try { src.stop(); } catch { /* already stopped */ } playing.delete(src); };
}

/** Short alert: the "text alert" sounds, or a synthesised two-tone if they can't load. */
export function chime(kind: "priority" | "turnout") {
  stopChimes();
  const gen = chimeGen;
  void play(kind === "priority" ? "priority-chime" : "turnout-chime", false).then((stop) => {
    if (gen !== chimeGen) { stop?.(); return; } // another sound took over while loading
    if (!stop) synthChime(kind);
    else chimeStop = stop;
  });
}
let chimeStop: (() => void) | null = null;

function stopChimes() {
  chimeGen++;
  chimeStop?.();
  chimeStop = null;
  synthNodes.forEach((n) => { try { n.stop(); } catch { /* not started */ } });
  synthNodes.clear();
}
const synthNodes = new Set<OscillatorNode>();

/** Silence every alert sound: chimes, alarm clips and synthesised tones. */
export function stopAlertSounds() {
  stopSiren();
  stopChimes();
  playing.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });
  playing.clear();
}

/** For test buttons: ignore quick repeat taps of the same button, and cut off
 *  whatever is playing before starting, so tests never sound over each other. */
let lastTest = { key: "", at: 0 };
export function testSound(key: string, play: () => void) {
  const now = Date.now();
  if (key === lastTest.key && now - lastTest.at < 700) return;
  lastTest = { key, at: now };
  unlockAlertAudio();
  stopAlertSounds();
  play();
}

/** Two-tone alert: hi-lo three times for priority, one soft pair otherwise. */
function synthChime(kind: "priority" | "turnout") {
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
      synthNodes.add(o);
      o.onended = () => synthNodes.delete(o);
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
        store.alertUnmute();
        if (alerts.prioritySound) chime("priority");
        try { navigator.vibrate?.([300, 120, 300, 120, 300]); } catch { /* no vibration */ }
        notify("Priority call", `${ev.title} · ${ev.call.code}`);
      } else if ((ev.type === "turnout" || ev.type === "station-turnout") && ev.stationId && watched.includes(ev.stationId)) {
        store.alertUnmute();
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
let stopClip: (() => void) | null = null;
let sirenGen = 0;

/** Full alarm: the priority / station call-out ringtone, looping (for up to 3
 *  minutes) until stopSiren() when `repeat`; synthesised if the sound can't load. */
export function siren(repeat: boolean, kind: "turnout" | "priority" = "turnout") {
  stopSiren();
  const gen = ++sirenGen;
  void play(kind === "priority" ? "priority-alarm" : "turnout-alarm", repeat).then((stop) => {
    if (gen !== sirenGen) { stop?.(); return; } // acknowledged while loading
    if (!stop) { synthSiren(repeat, kind); return; }
    stopClip = stop;
    if (repeat) sirenTimer = window.setTimeout(stopSiren, 3 * 60_000);
  });
}

/** Synthesised fallback. Turnout is a slow hi-lo; priority a faster, higher warble. */
function synthSiren(repeat: boolean, kind: "turnout" | "priority") {
  if (!ctx) return;
  const [hi, lo, step, n] = kind === "priority" ? [1480, 1040, 0.16, 12] : [1180, 780, 0.3, 6];
  const burst = () => {
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const t = t0 + i * step;
      o.type = "square";
      o.frequency.setValueAtTime(i % 2 ? lo : hi, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.01);
      g.gain.setValueAtTime(0.16, t + step - 0.04);
      g.gain.linearRampToValueAtTime(0, t + step - 0.01);
      o.connect(g).connect(ctx.destination);
      track(o);
      o.start(t);
      o.stop(t + step);
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
  sirenGen++;
  clearInterval(sirenTimer);
  clearTimeout(sirenTimer);
  sirenTimer = undefined;
  stopClip?.();
  stopClip = null;
}
