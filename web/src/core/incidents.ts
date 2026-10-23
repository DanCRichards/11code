import type { Board } from "./derive";
import { isCommitted } from "./derive";
import type { Index } from "./interpret";
import type { Interpreted } from "./types";

/** Turnouts that look like one job: close in time and place. */
export interface Job {
  id: string;
  start: number;
  last: number;
  stationIds: string[];
  applianceIds: string[];
  turnouts: Interpreted[];
  active: boolean; // any of its appliances still committed
}

const NEARBY_KM = 6;

function km(ix: Index, a: string, b: string): number {
  const p = ix.station.get(a), q = ix.station.get(b);
  if (!p || !q) return Infinity;
  const r = Math.PI / 180;
  const dLat = (q.lat - p.lat) * r, dLon = (q.lon - p.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * r) * Math.cos(q.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Group turnouts (oldest-first events) into jobs. A turnout joins the latest
 * job if it's within `windowMs` of that job's last turnout and its station is
 * the same or within a few km. Appliances that report "responding" soon after
 * their station is turned out join that job too. Newest job first.
 */
export function groupJobs(events: Interpreted[], ix: Index, board: Board, windowMs: number): Job[] {
  const jobs: Job[] = [];
  for (const ev of events) {
    const t = ev.call.time;
    if ((ev.type === "turnout" || ev.type === "station-turnout") && ev.stationId) {
      let job = [...jobs].reverse().find((j) => t - j.last <= windowMs &&
        j.stationIds.some((s) => s === ev.stationId || km(ix, s, ev.stationId!) <= NEARBY_KM));
      if (!job) {
        job = { id: ev.call.id, start: t, last: t, stationIds: [], applianceIds: [], turnouts: [], active: false };
        jobs.push(job);
      }
      job.last = t;
      job.turnouts.push(ev);
      if (!job.stationIds.includes(ev.stationId)) job.stationIds.push(ev.stationId);
      if (ev.applianceId && !job.applianceIds.includes(ev.applianceId)) job.applianceIds.push(ev.applianceId);
    } else if (ev.type === "status" && ev.state === "responding" && ev.applianceId && ev.stationId) {
      const job = [...jobs].reverse().find((j) => t - j.last <= windowMs * 3 && j.stationIds.includes(ev.stationId!));
      if (job && !job.applianceIds.includes(ev.applianceId)) job.applianceIds.push(ev.applianceId);
    }
  }
  for (const j of jobs) {
    j.active = j.applianceIds.some((id) => isCommitted(board.appliances.get(id)?.state ?? "not-heard"));
  }
  return jobs.reverse();
}
