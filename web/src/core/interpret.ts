import type {
  Appliance, ApplianceState, Call, Codebook, Interpreted, Station,
} from "./types";
import { MIN_CONFIDENCE } from "./types";

export interface Index {
  station: Map<string, Station>;
  appliance: Map<string, Appliance>;
  bySelcall: Map<string, Appliance>;
  turnout: Map<string, { stationId: string; applianceId: string | null }>;
  status: Map<string, { label: string; state: ApplianceState; kCode: string; arrival?: boolean }>;
  callType: Map<string, { label: string; priority: boolean }>;
}

export function buildIndex(cb: Codebook): Index {
  return {
    station: new Map(cb.stations.map((s) => [s.id, s])),
    appliance: new Map(cb.appliances.map((a) => [a.id, a])),
    bySelcall: new Map(cb.appliances.filter((a) => a.selcallId).map((a) => [a.selcallId, a])),
    turnout: new Map(cb.turnoutCodes.map((t) => [t.code, { stationId: t.stationId, applianceId: t.applianceId }])),
    status: new Map(cb.statusCodes.map((s) => [s.suffix, s])),
    callType: new Map(cb.callTypes.map((c) => [c.final, c])),
  };
}

export function applianceName(ix: Index, a: Appliance): string {
  const s = ix.station.get(a.stationId);
  return s ? `${s.name} ${a.callsign}` : a.callsign;
}

/** What a decoded call means under the current codebook. */
export function interpret(call: Call, ix: Index): Interpreted {
  if (!call.code || call.confidence < MIN_CONFIDENCE || call.code.includes("?")) {
    return { call, type: "unreadable", label: "Unreadable", title: call.code ? "Garbled call" : "No tones found" };
  }
  if (call.kind === "station" || /^1\d{5}$/.test(call.code)) {
    const t = ix.turnout.get(call.code);
    if (!t) return { call, type: "unknown-code", label: "Unknown code", title: `Station code ${call.code}` };
    const s = ix.station.get(t.stationId);
    const a = t.applianceId ? ix.appliance.get(t.applianceId) : undefined;
    if (a) {
      return { call, type: "turnout", stationId: t.stationId, applianceId: a.id, state: "turned-out",
               label: "Turnout", title: applianceName(ix, a) };
    }
    // 182 + station number + 0: the station acknowledging its turnout, not a call-out.
    return { call, type: "station-ack", stationId: t.stationId, label: "Acknowledged",
             title: s ? `${s.name} acknowledged` : `Station ${t.stationId} acknowledged` };
  }
  const header = call.code.slice(0, 5);
  const a = ix.bySelcall.get(header);
  if (!a) return { call, type: "unknown-code", label: "Unknown unit", title: `Unit ${header}` };
  const name = applianceName(ix, a);
  if (call.code.includes("-")) {
    const suffix = call.code.split("-")[1];
    const st = ix.status.get(suffix);
    if (!st) {
      return { call, type: "unknown-status", stationId: a.stationId, applianceId: a.id, state: "status-unknown",
               label: "Unknown status", title: name };
    }
    return { call, type: "status", stationId: a.stationId, applianceId: a.id, state: st.state,
             label: st.kCode ? `${st.kCode} ${st.label}` : st.label, title: name,
             status: { kCode: st.kCode, label: st.label, arrival: st.arrival } };
  }
  const ct = ix.callType.get(call.code[5]);
  if (ct?.priority) {
    return { call, type: "priority", stationId: a.stationId, applianceId: a.id, label: ct.label, title: name };
  }
  return { call, type: "appliance-call", stationId: a.stationId, applianceId: a.id,
           label: ct?.label ?? `Call (final ${call.code[5]})`, title: name };
}

export function interpretAll(calls: Call[], ix: Index): Interpreted[] {
  return calls.map((c) => interpret(c, ix));
}
