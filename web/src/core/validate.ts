import type { Codebook } from "./types";

const TONE = /^[0-9A-F]+$/;

/** Mirrors server/store.py validate_codebook; returns problems (empty = fine). */
export function validateCodebook(cb: Codebook): string[] {
  const problems: string[] = [];
  const stationIds = new Set(cb.stations.map((s) => s.id));
  const appIds = new Set(cb.appliances.map((a) => a.id));
  if (stationIds.size !== cb.stations.length) problems.push("Station ids must be unique.");
  if (appIds.size !== cb.appliances.length) problems.push("Appliance ids must be unique.");
  for (const s of cb.stations) {
    if (!s.id || !s.name) problems.push("Every station needs an id and a name.");
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) problems.push(`${s.name}: location must be numbers.`);
  }
  const sel = new Map<string, string>();
  for (const a of cb.appliances) {
    if (!stationIds.has(a.stationId)) problems.push(`Appliance ${a.callsign}: pick a station.`);
    if (a.selcallId && !(a.selcallId.length === 5 && TONE.test(a.selcallId))) {
      problems.push(`Appliance ${a.callsign}: selcall ID must be 5 tones (0-9, A-F).`);
    }
    if (a.selcallId && sel.has(a.selcallId)) {
      problems.push(`Selcall ID ${a.selcallId} is used by both ${sel.get(a.selcallId)} and ${a.callsign}.`);
    }
    if (a.selcallId) sel.set(a.selcallId, a.callsign);
  }
  const codes = new Set<string>();
  for (const c of cb.turnoutCodes) {
    if (!(c.code.length === 6 && TONE.test(c.code))) problems.push(`Turnout code ${c.code || "(blank)"} must be 6 tones.`);
    if (codes.has(c.code)) problems.push(`Turnout code ${c.code} is listed twice.`);
    codes.add(c.code);
    if (!stationIds.has(c.stationId)) problems.push(`Turnout code ${c.code}: pick a station.`);
    if (c.applianceId && !appIds.has(c.applianceId)) problems.push(`Turnout code ${c.code}: unknown appliance.`);
  }
  const suffixes = new Set<string>();
  for (const s of cb.statusCodes) {
    if (!s.suffix || !TONE.test(s.suffix)) problems.push(`Status code "${s.suffix}" must be tones (0-9, A-F).`);
    if (suffixes.has(s.suffix)) problems.push(`Status code ${s.suffix} is listed twice.`);
    suffixes.add(s.suffix);
  }
  const finals = new Set<string>();
  for (const c of cb.callTypes) {
    if (!(c.final.length === 1 && TONE.test(c.final))) problems.push(`Call type final "${c.final}" must be one tone.`);
    if (finals.has(c.final)) problems.push(`Call type ${c.final} is listed twice.`);
    finals.add(c.final);
  }
  return [...new Set(problems)];
}
