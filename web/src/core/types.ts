import type { CallKind, Slot } from "../decoder/selcall";

export interface Station {
  id: string;
  name: string;
  number: string;
  lat: number;
  lon: number;
}

export interface Appliance {
  id: string;
  callsign: string;
  stationId: string;
  type: string;
  selcallId: string;
  selcallVerified: boolean;
}

export interface TurnoutCode {
  code: string;
  stationId: string;
  applianceId: string | null; // null = whole-station call
  source: "list" | "pattern" | "user";
}

export interface CallType {
  final: string; // last tone of a short appliance call
  label: string;
  priority: boolean;
  verified: boolean;
}

export type ApplianceState =
  | "not-heard" | "turned-out" | "responding" | "at-incident" | "out-of-area"
  | "available-radio" | "on-station" | "status-unknown";

export interface StatusCode {
  suffix: string; // everything after the "-" in a long message, e.g. "F1A0C2"
  kCode: string;
  label: string;
  state: ApplianceState;
  demo?: boolean;
}

export interface Codebook {
  schema: number;
  version: number;
  updatedAt: string;
  region: string;
  stations: Station[];
  appliances: Appliance[];
  turnoutCodes: TurnoutCode[];
  callTypes: CallType[];
  statusCodes: StatusCode[];
}

/** One decoded transmission, from the demo or the backend. */
export interface Call {
  id: string;
  time: number; // ms since epoch
  code: string; // "" when no tones could be read
  kind: CallKind | "none";
  confidence: number;
  source: string;
  slots?: Slot[]; // demo only: per-slot tone picks for the readout
  sent?: string; // demo only: what was actually transmitted
}

export type EventType =
  | "turnout" | "station-turnout" | "status" | "priority" | "appliance-call"
  | "unknown-code" | "unknown-status" | "unreadable";

export interface Interpreted {
  call: Call;
  type: EventType;
  stationId?: string;
  applianceId?: string;
  state?: ApplianceState;
  label: string; // short, e.g. "Responding"
  title: string; // e.g. "Grey Lynn 261"
}

export const MIN_CONFIDENCE = 0.5;
