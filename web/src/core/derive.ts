import type { Index } from "./interpret";
import type { ApplianceState, Interpreted } from "./types";

export interface ApplianceBoard {
  state: ApplianceState;
  lastHeard?: number;
  lastEvent?: Interpreted;
  priorityAt?: number;
  status?: Interpreted["status"]; // the K code behind the current state, if a status message set it
  history: Interpreted[]; // newest first
}

export interface StationBoard {
  lastTurnout?: number;
  lastTurnoutEvent?: Interpreted;
  turnoutsToday: number;
  history: Interpreted[]; // newest first
}

export interface InboxItem {
  key: string;
  what: "station-code" | "unit" | "status";
  code: string; // the unknown part: full code, unit header, or status suffix
  applianceId?: string; // for unknown statuses
  count: number;
  first: number;
  last: number;
  example: string; // a full decoded code
  suggestion?: { stationId: string; applianceId: string | null; reason: string };
}

export interface Board {
  appliances: Map<string, ApplianceBoard>;
  stations: Map<string, StationBoard>;
  turnouts: Interpreted[]; // newest first
  priorities: Interpreted[]; // newest first
  inbox: InboxItem[];
}

const dayFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" });
export const nzDay = (t: number) => dayFmt.format(t);

/** "182" + appliance callsign, or "182" + station number + "0" for a whole-station call. */
export function suggestForStationCode(code: string, ix: Index): InboxItem["suggestion"] {
  if (!/^182\d{3}$/.test(code)) return undefined;
  const tail = code.slice(3);
  for (const a of ix.appliance.values()) {
    if (a.callsign === tail) {
      return { stationId: a.stationId, applianceId: a.id, reason: `182 + callsign ${tail}` };
    }
  }
  if (tail.endsWith("0")) {
    for (const s of ix.station.values()) {
      if (s.number && s.number === tail.slice(0, 2)) {
        return { stationId: s.id, applianceId: null, reason: `182 + station ${s.number} + 0` };
      }
    }
  }
  return undefined;
}

/** Fold the call log (oldest first) into the current board. */
export function deriveBoard(events: Interpreted[], ix: Index, now: number, dismissed: Set<string>): Board {
  const appliances = new Map<string, ApplianceBoard>();
  const stations = new Map<string, StationBoard>();
  for (const a of ix.appliance.values()) appliances.set(a.id, { state: "not-heard", history: [] });
  for (const s of ix.station.values()) stations.set(s.id, { turnoutsToday: 0, history: [] });
  const today = nzDay(now);
  const turnouts: Interpreted[] = [], priorities: Interpreted[] = [];
  const inbox = new Map<string, InboxItem>();

  for (const ev of events) {
    const t = ev.call.time;
    const sb = ev.stationId ? stations.get(ev.stationId) : undefined;
    const ab = ev.applianceId ? appliances.get(ev.applianceId) : undefined;
    if (sb) sb.history.unshift(ev);
    if (ab) {
      ab.history.unshift(ev);
      ab.lastHeard = t;
      ab.lastEvent = ev;
      if (ev.state) { ab.state = ev.state; ab.status = ev.status; }
    }
    if (ev.type === "turnout" || ev.type === "station-turnout") {
      turnouts.unshift(ev);
      if (sb) {
        sb.lastTurnout = t;
        sb.lastTurnoutEvent = ev;
        if (nzDay(t) === today) sb.turnoutsToday++;
      }
    }
    if (ev.type === "priority") {
      priorities.unshift(ev);
      if (ab) ab.priorityAt = t;
    }
    if (ev.type === "unknown-code" || ev.type === "unknown-status") {
      const code = ev.call.code;
      const what = ev.type === "unknown-status" ? "status" : /^\d/.test(code) ? "station-code" : "unit";
      const part = what === "station-code" ? code : what === "unit" ? code.slice(0, 5) : code.split("-")[1];
      const key = `${what}:${part}`;
      if (dismissed.has(key)) continue;
      const item = inbox.get(key) ?? {
        key, what, code: part, applianceId: ev.applianceId, count: 0, first: t, last: t, example: code,
        suggestion: what === "station-code" ? suggestForStationCode(code, ix) : undefined,
      };
      item.count++;
      item.last = t;
      item.example = code;
      inbox.set(key, item);
    }
  }
  return {
    appliances, stations, turnouts, priorities,
    inbox: [...inbox.values()].sort((a, b) => b.last - a.last),
  };
}

export const COMMITTED: ApplianceState[] = ["turned-out", "responding", "at-incident", "out-of-area", "status-unknown"];
export const isCommitted = (s: ApplianceState) => COMMITTED.includes(s);

export const STATE_LABEL: Record<ApplianceState, string> = {
  "not-heard": "Not heard",
  "turned-out": "Turned out",
  responding: "Responding",
  "at-incident": "At incident",
  "out-of-area": "Out of area",
  "available-radio": "Available (radio)",
  "on-station": "On station",
  "status-unknown": "Unknown status",
};

/** FENZ K codes for the statuses a truck sends (see CLAUDE.md). */
export const K_CODE: Partial<Record<ApplianceState, string>> = {
  responding: "K1", "at-incident": "K2", "out-of-area": "K3", "available-radio": "K4", "on-station": "K7",
};

/** A state with its usual K code, e.g. "K1 Responding". */
export const stateText = (s: ApplianceState) => (K_CODE[s] ? `${K_CODE[s]} ${STATE_LABEL[s]}` : STATE_LABEL[s]);

/** A truck's status as heard, e.g. "K99 Well-involved fire"; falls back to its state. */
export const boardText = (ab: Pick<ApplianceBoard, "state" | "status">) =>
  ab.status?.kCode ? `${ab.status.kCode} ${ab.status.label}` : stateText(ab.state);
