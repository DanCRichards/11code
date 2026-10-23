import { useSyncExternalStore } from "react";
import bundled from "../../data/codebook.json";
import type { Call, Codebook } from "./core/types";

export type Mode = "demo" | "file" | "input" | "backend";

export interface SimSettings {
  auto: boolean;
  speed: number; // simulated seconds per real second
  snr: number; // audio SNR in dB
  sound: boolean;
}

export interface InputSettings {
  deviceId: string; // "" = the browser's default input
  monitor: boolean; // play the input to the speakers/headphones
  volume: number; // 0-1 monitor volume
}

export interface InputState {
  status: "idle" | "starting" | "listening" | "error";
  devices: { id: string; label: string }[];
  level: number; // 0-1 input level (RMS, scaled)
  peak: number; // 0-1 recent peak, to spot clipping
  error?: string;
  heard: number; // calls decoded this session
  rate?: number; // capture sample rate
}

export interface AlertSettings {
  prioritySound: boolean; // chime for priority calls
  watchedSound: boolean; // chime when a watched station is turned out
  notify: boolean; // system notification for those, when the page is in the background
}

export interface Settings {
  mode: Mode;
  backendUrl: string; // "" = same origin as the page
  apiKey: string;
  sim: SimSettings;
  input: InputSettings;
  alerts: AlertSettings;
  watched: string[]; // station ids starred by the user
  showMap: boolean | null; // null = default for the screen size
  dismissed: string[]; // inbox keys the user chose to ignore
}

export interface Connection {
  status: "demo" | "file" | "input" | "connecting" | "live" | "reconnecting" | "error";
  message?: string;
}

/** A call found in an imported recording, at `offset` seconds into it. */
export interface FileCall {
  offset: number;
  call: Call;
}

export interface Player {
  name: string;
  duration: number;
  position: number; // seconds
  playing: boolean;
  decoding: number | null; // progress 0-1 while decoding, else null
  found: FileCall[];
  envelope: number[]; // 0-1 loudness per bin, for the scrubber
  reveal: "play" | "all"; // show calls as playback reaches them, or all at once
  error?: string;
}

export interface State {
  codebook: Codebook;
  codebookOrigin: "bundled" | "local" | "backend";
  calls: Call[]; // oldest first
  lastCall?: Call;
  settings: Settings;
  connection: Connection;
  player?: Player;
  input?: InputState;
}

export const BUNDLED = bundled as unknown as Codebook;
const MAX_CALLS = 1500;

// Browser storage can be missing or throw (private mode, sandboxed previews).
export function load<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}
export function save(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not persisted; fine for a demo */
  }
}

const DEFAULT_SETTINGS: Settings = {
  mode: "demo",
  backendUrl: "",
  apiKey: "",
  sim: { auto: true, speed: 20, snr: 8, sound: false },
  input: { deviceId: "", monitor: true, volume: 0.8 },
  alerts: { prioritySound: true, watchedSound: true, notify: false },
  watched: [],
  showMap: null,
  dismissed: [],
};

function initialSettings(): Settings {
  const saved = load<Partial<Settings>>("tb.settings") ?? {};
  const s: Settings = {
    ...DEFAULT_SETTINGS, ...saved,
    sim: { ...DEFAULT_SETTINGS.sim, ...saved.sim },
    input: { ...DEFAULT_SETTINGS.input, ...saved.input },
    alerts: { ...DEFAULT_SETTINGS.alerts, ...saved.alerts },
  };
  s.sim.sound = false; // audio needs a tap each visit
  // ?backend=https://host:8080 (or #backend=... is not allowed in some hosts) preselects live mode.
  try {
    const q = new URLSearchParams(location.search).get("backend");
    if (q) { s.mode = "backend"; s.backendUrl = q; }
  } catch { /* no location */ }
  return s;
}

const localCodebook = load<Codebook>("tb.codebook.local");

let state: State = {
  codebook: localCodebook ?? BUNDLED,
  codebookOrigin: localCodebook ? "local" : "bundled",
  calls: [],
  settings: initialSettings(),
  connection: { status: "demo" },
};

const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  },
  settings(patch: Partial<Settings>) {
    const settings = { ...state.settings, ...patch };
    save("tb.settings", settings);
    store.set({ settings });
  },
  sim(patch: Partial<SimSettings>) {
    store.settings({ sim: { ...state.settings.sim, ...patch } });
  },
  alertSettings(patch: Partial<AlertSettings>) {
    store.settings({ alerts: { ...state.settings.alerts, ...patch } });
  },
  toggleWatch(stationId: string) {
    const w = state.settings.watched;
    store.settings({ watched: w.includes(stationId) ? w.filter((x) => x !== stationId) : [...w, stationId] });
  },
  inputSettings(patch: Partial<InputSettings>) {
    store.settings({ input: { ...state.settings.input, ...patch } });
  },
  addCalls(calls: Call[]) {
    if (!calls.length) return;
    const all = [...state.calls, ...calls].sort((a, b) => a.time - b.time);
    store.set({ calls: all.slice(-MAX_CALLS), lastCall: calls[calls.length - 1] });
  },
  replaceCalls(calls: Call[]) {
    const sorted = [...calls].sort((a, b) => a.time - b.time).slice(-MAX_CALLS);
    store.set({ calls: sorted, lastCall: sorted[sorted.length - 1] });
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state));
}
