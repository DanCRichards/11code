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
  unmuteSeconds: number; // when an alert fires, un-mute radio audio for this long (0 = don't)
}

/** Full-screen alarm for priority calls: from any truck, or only chosen ones. */
export interface PriorityAlarmSettings {
  scope: "off" | "any" | "chosen";
  stations: string[];
  appliances: string[];
  autoClear: number; // seconds until the alarm clears by itself; 0 = wait for Acknowledge
}

/** One saved board: a name and its trucks. */
export interface SavedBoard {
  id: string;
  name: string;
  appliances: string[];
}

export interface MyBoardSettings {
  appliances: string[]; // trucks on the board being shown (kept in step with boards[active])
  size: "large" | "compact";
  boards: SavedBoard[];
  active: string; // id of the board being shown
}

/** Full-screen turnout alarm for chosen stations and trucks. */
export interface AlarmSettings {
  stations: string[]; // any turnout at these stations
  appliances: string[]; // these trucks
  sound: boolean;
  repeat: boolean; // keep sounding until acknowledged
  autoClear: number; // seconds until the alarm clears by itself; 0 = wait for Acknowledge
}

export interface Settings {
  mode: Mode;
  backendUrl: string; // "" = same origin as the page
  apiKey: string;
  sim: SimSettings;
  input: InputSettings;
  alerts: AlertSettings;
  watched: string[]; // station ids starred by the user
  myBoard: MyBoardSettings;
  alarm: AlarmSettings;
  priorityAlarm: PriorityAlarmSettings;
  muted: boolean; // radio audio (monitor, demo tones, recordings) muted by the user
  showMap: boolean | null; // null = default for the screen size
  dismissed: string[]; // inbox keys the user chose to ignore
  priorityHiddenUntil: number; // the priority banner stays hidden for calls up to this time (a little slack for recordings, whose times shift slightly)
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
  unmutedUntil?: number; // an alert has un-muted radio audio until this time
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
  alerts: { prioritySound: true, watchedSound: true, notify: false, unmuteSeconds: 45 },
  watched: [],
  myBoard: { appliances: [], size: "large", boards: [{ id: "main", name: "My board", appliances: [] }], active: "main" },
  alarm: { stations: [], appliances: [], sound: true, repeat: true, autoClear: 0 },
  priorityAlarm: { scope: "off", stations: [], appliances: [], autoClear: 0 },
  muted: false,
  showMap: null,
  dismissed: [],
  priorityHiddenUntil: 0,
};

function initialSettings(): Settings {
  const saved = load<Partial<Settings>>("tb.settings") ?? {};
  const s: Settings = {
    ...DEFAULT_SETTINGS, ...saved,
    sim: { ...DEFAULT_SETTINGS.sim, ...saved.sim },
    input: { ...DEFAULT_SETTINGS.input, ...saved.input },
    alerts: { ...DEFAULT_SETTINGS.alerts, ...saved.alerts },
    myBoard: migrateBoards({ ...DEFAULT_SETTINGS.myBoard, ...saved.myBoard }),
    alarm: { ...DEFAULT_SETTINGS.alarm, ...saved.alarm },
    priorityAlarm: { ...DEFAULT_SETTINGS.priorityAlarm, ...saved.priorityAlarm },
  };
  s.sim.sound = false; // audio needs a tap each visit
  // ?backend=https://host:8080 (or #backend=... is not allowed in some hosts) preselects live mode.
  try {
    const q = new URLSearchParams(location.search).get("backend");
    if (q) { s.mode = "backend"; s.backendUrl = q; }
  } catch { /* no location */ }
  return s;
}

/** Older saves had one board; make it the first saved board. */
function migrateBoards(b: MyBoardSettings): MyBoardSettings {
  const boards = b.boards?.length && b.boards !== DEFAULT_SETTINGS.myBoard.boards
    ? b.boards : [{ id: "main", name: "My board", appliances: b.appliances ?? [] }];
  const active = boards.find((x) => x.id === b.active) ? b.active : boards[0].id;
  return { ...b, boards, active, appliances: boards.find((x) => x.id === active)!.appliances };
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
let unmuteTimer: ReturnType<typeof setTimeout> | undefined;

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
  /** Changing `appliances` changes the board being shown. */
  myBoard(patch: Partial<MyBoardSettings>) {
    const cur = { ...state.settings.myBoard, ...patch };
    if (patch.appliances) cur.boards = cur.boards.map((b) => (b.id === cur.active ? { ...b, appliances: patch.appliances! } : b));
    store.settings({ myBoard: cur });
  },
  showBoard(id: string) {
    const b = state.settings.myBoard.boards.find((x) => x.id === id);
    if (b) store.myBoard({ active: id, appliances: b.appliances });
  },
  addBoard(name: string): string {
    const id = `b${Date.now().toString(36)}`;
    const boards = [...state.settings.myBoard.boards, { id, name, appliances: [] }];
    store.settings({ myBoard: { ...state.settings.myBoard, boards, active: id, appliances: [] } });
    return id;
  },
  renameBoard(id: string, name: string) {
    store.myBoard({ boards: state.settings.myBoard.boards.map((b) => (b.id === id ? { ...b, name } : b)) });
  },
  deleteBoard(id: string) {
    const boards = state.settings.myBoard.boards.filter((b) => b.id !== id);
    if (!boards.length) return;
    const active = state.settings.myBoard.active === id ? boards[0].id : state.settings.myBoard.active;
    store.settings({ myBoard: { ...state.settings.myBoard, boards, active, appliances: boards.find((b) => b.id === active)!.appliances } });
  },
  priorityAlarm(patch: Partial<PriorityAlarmSettings>) {
    store.settings({ priorityAlarm: { ...state.settings.priorityAlarm, ...patch } });
  },
  /** Radio audio plays unless muted, or while an alert has temporarily un-muted it. */
  audible(): boolean {
    return !state.settings.muted || (state.unmutedUntil ?? 0) > Date.now();
  },
  /** An alert fired: un-mute radio audio for the configured time. */
  alertUnmute() {
    const secs = state.settings.alerts.unmuteSeconds;
    if (!secs || !state.settings.muted) return;
    const until = Date.now() + secs * 1000;
    store.set({ unmutedUntil: until });
    clearTimeout(unmuteTimer);
    unmuteTimer = setTimeout(() => store.set({ unmutedUntil: undefined }), secs * 1000 + 50);
  },
  /** Acknowledged: go back to muted now rather than waiting out the un-mute. */
  endUnmute() {
    clearTimeout(unmuteTimer);
    if (state.unmutedUntil) store.set({ unmutedUntil: undefined });
  },
  alarm(patch: Partial<AlarmSettings>) {
    store.settings({ alarm: { ...state.settings.alarm, ...patch } });
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
