import { useMemo, useState } from "react";
import { isCommitted, nzDay } from "../core/derive";
import type { ApplianceState, EventType } from "../core/types";
import { ago, StatePill, stateVar, useBoard } from "./common";
import { LogItem, openEvent } from "./LiveView";
import type { Nav } from "./nav";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function AppliancesView({ nav, filter: initial }: { nav: Nav; filter?: string }) {
  const { ix, board, now } = useBoard();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(initial ?? "all");
  const [sort, setSort] = useState<"heard" | "station" | "callsign">("heard");

  const rows = useMemo(() => [...ix.appliance.values()].map((a) => ({
    a, b: board.appliances.get(a.id)!, station: ix.station.get(a.stationId)!,
  })), [ix, board]);
  const groups: [string, string, (s: ApplianceState) => boolean][] = [
    ["all", "All", () => true],
    ["out", "Out", isCommitted],
    ["available", "Available", (s) => s === "available-radio" || s === "on-station"],
    ["not-heard", "Not heard", (s) => s === "not-heard"],
  ];
  const test = groups.find((g) => g[0] === filter)?.[2] ?? (() => true);
  const needle = norm(q);
  const shown = rows
    .filter((r) => test(r.b.state))
    .filter((r) => !needle || norm(`${r.a.callsign} ${r.station.name} ${r.a.selcallId}`).includes(needle))
    .sort((x, y) => sort === "heard" ? (y.b.lastHeard ?? 0) - (x.b.lastHeard ?? 0)
      : sort === "station" ? x.station.name.localeCompare(y.station.name) || x.a.callsign.localeCompare(y.a.callsign)
      : x.a.callsign.localeCompare(y.a.callsign, undefined, { numeric: true }));

  return (
    <>
      <h1 className="page-title">Appliances</h1>
      <input className="search" type="search" placeholder="Search callsign, station or selcall ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search appliances" />
      <div className="chips" role="group" aria-label="Filter by status">
        {groups.map(([key, label, fn]) => (
          <button key={key} className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label}<b>{rows.filter((r) => fn(r.b.state)).length}</b>
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted small">{shown.length} appliance{shown.length === 1 ? "" : "s"}</span>
          <label className="small muted">Sort{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort appliances">
              <option value="heard">Last heard</option><option value="station">Station</option><option value="callsign">Callsign</option>
            </select>
          </label>
        </div>
        {shown.length === 0 ? <p className="empty">No appliances match.</p> : (
          <ul className="list">
            {shown.map(({ a, b, station }) => (
              <li key={a.id}>
                <button className="item" onClick={() => nav.appliance(a.id)}>
                  <span className="callsign" style={{ color: b.state === "not-heard" ? "var(--muted)" : stateVar(b.state) }}>{a.callsign}</span>
                  <span className="what"><b>{station.name}</b><span>{b.lastEvent ? `${b.lastEvent.label} · ${ago(b.lastHeard, now)}` : "Not heard yet"}{b.priorityAt ? " · priority call" : ""}</span></span>
                  <StatePill state={b.state} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function StationsView({ nav }: { nav: Nav }) {
  const { ix, board, now } = useBoard();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "number">("recent");
  const needle = norm(q);
  const rows = [...ix.station.values()]
    .filter((s) => !needle || norm(`${s.name} ${s.number}`).includes(needle))
    .map((s) => ({ s, b: board.stations.get(s.id)!, apps: [...ix.appliance.values()].filter((a) => a.stationId === s.id) }))
    .sort((x, y) => sort === "recent" ? (y.b.lastTurnout ?? 0) - (x.b.lastTurnout ?? 0) || x.s.name.localeCompare(y.s.name)
      : sort === "name" ? x.s.name.localeCompare(y.s.name) : (x.s.number || "99").localeCompare(y.s.number || "99"));
  return (
    <>
      <h1 className="page-title">Stations</h1>
      <input className="search" type="search" placeholder="Search station name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stations" />
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted small">{rows.length} stations</span>
          <label className="small muted">Sort{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort stations">
              <option value="recent">Last turnout</option><option value="name">Name</option><option value="number">Station number</option>
            </select>
          </label>
        </div>
        <ul className="list">
          {rows.map(({ s, b, apps }) => (
            <li key={s.id}>
              <button className="item" onClick={() => nav.station(s.id)}>
                <span className="callsign muted" style={{ fontSize: 18 }}>{s.number || "–"}</span>
                <span className="what">
                  <b>{s.name}</b>
                  <span>{b.lastTurnout ? `Turned out ${ago(b.lastTurnout, now)} · ${b.turnoutsToday} today` : "No turnouts heard"}</span>
                </span>
                <span className="row" style={{ gap: 4 }} aria-label="Appliance statuses">
                  {apps.map((a) => <i key={a.id} className="dot" title={`${a.callsign}`} style={{ background: stateVar(board.appliances.get(a.id)!.state) }} />)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const LOG_FILTERS: [string, string, EventType[] | null][] = [
  ["all", "All", null],
  ["turnouts", "Turnouts", ["turnout", "station-turnout"]],
  ["status", "Statuses", ["status"]],
  ["priority", "Priority", ["priority"]],
  ["other", "Other calls", ["appliance-call"]],
  ["unknown", "Unknown", ["unknown-code", "unknown-status"]],
  ["unreadable", "Unreadable", ["unreadable"]],
];

export function LogView({ nav, filter: initial }: { nav: Nav; filter?: string }) {
  const { events, now } = useBoard();
  const [filter, setFilter] = useState(initial ?? "all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(150);
  const types = LOG_FILTERS.find((f) => f[0] === filter)?.[2];
  const needle = norm(q);
  const shown = events.filter((e) => !types || types.includes(e.type))
    .filter((e) => !needle || norm(`${e.title} ${e.call.code} ${e.label}`).includes(needle))
    .reverse();
  let lastDay = "";
  return (
    <>
      <h1 className="page-title">Radio log</h1>
      <input className="search" type="search" placeholder="Search unit, station or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search log" />
      <div className="chips" role="group" aria-label="Filter log">
        {LOG_FILTERS.map(([key, label, t]) => (
          <button key={key} className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label}<b>{t ? events.filter((e) => t.includes(e.type)).length : events.length}</b>
          </button>
        ))}
      </div>
      <section className="panel">
        {shown.length === 0 ? <p className="empty">Nothing in the log matches.</p> : (
          <ul className="list">
            {shown.slice(0, limit).flatMap((e) => {
              const day = nzDay(e.call.time);
              const head = day !== lastDay && lastDay !== "" ? [<li key={`d${day}`} className="small muted" style={{ padding: "8px 2px" }}>{day}</li>] : [];
              lastDay = day;
              return [...head, <LogItem key={e.call.id} ev={e} now={now} absolute onOpen={() => openEvent(e, nav)} />];
            })}
          </ul>
        )}
        {shown.length > limit && <button className="btn" onClick={() => setLimit(limit + 300)}>Show older calls ({shown.length - limit} more)</button>}
      </section>
    </>
  );
}
