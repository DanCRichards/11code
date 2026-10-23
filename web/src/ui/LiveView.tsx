import { useMemo, useState } from "react";
import { boardText, isCommitted, nzDay, stateText } from "../core/derive";
import { groupJobs, type Job } from "../core/incidents";
import { applianceName, type Index } from "../core/interpret";
import type { ApplianceState, Interpreted } from "../core/types";
import { demoActions, inputActions } from "../sources/controller";
import { store, useStore } from "../store";
import { ago, clockTime, EventPill, stateVar, ToneStrip, useBoard } from "./common";
import { MapView } from "./MapView";
import type { Nav } from "./nav";

export function useWindows() {
  const mode = useStore((s) => s.settings.mode);
  const speed = useStore((s) => s.settings.sim.speed);
  const k = mode === "demo" ? speed : 1;
  return { recentMs: (15 * 60_000) / k, priorityMs: (20 * 60_000) / k, jobMs: (3 * 60_000) / k };
}

const BOARD_GROUPS: [ApplianceState, string][] = [
  ["turned-out", "Turned out"], ["responding", "Responding"], ["at-incident", "At incident"],
  ["out-of-area", "Out of area"], ["status-unknown", "Unknown status"], ["available-radio", "Available on radio"],
];

export function LiveView({ nav }: { nav: Nav }) {
  const { ix, events, board, now } = useBoard();
  const lastCall = useStore((s) => s.lastCall);
  const watched = useStore((s) => s.settings.watched);
  const showMapSetting = useStore((s) => s.settings.showMap);
  const showMap = showMapSetting ?? (typeof window !== "undefined" && window.innerWidth >= 1100);
  const { recentMs, priorityMs, jobMs } = useWindows();
  const hiddenUntil = useStore((s) => s.settings.priorityHiddenUntil);

  const today = nzDay(now);
  const turnoutsToday = board.turnouts.filter((e) => nzDay(e.call.time) === today).length;
  const outCount = [...board.appliances.values()].filter((b) => isCommitted(b.state)).length;
  const priorityToday = board.priorities.filter((e) => nzDay(e.call.time) === today).length;
  const prio = board.priorities[0];
  const showPrio = prio && now - prio.call.time < priorityMs && prio.call.time > hiddenUntil;
  const jobs = useMemo(() => groupJobs(events, ix, board, jobMs), [events, ix, board, jobMs]);
  const lastEv = lastCall ? events.find((e) => e.call.id === lastCall.id) : undefined;

  return (
    <>
      {showPrio && (
        <div className="banner" role="alert">
          <span className="banner-icon" aria-hidden="true">!</span>
          <div className="grow">
            <b>Priority call</b>
            <div>{prio.title} wants Comcen to respond · {ago(prio.call.time, now)}</div>
          </div>
          <button onClick={() => prio.applianceId && nav.appliance(prio.applianceId)}>View</button>
          <button onClick={() => store.settings({ priorityHiddenUntil: prio.call.time + 1500 })} aria-label="Dismiss">Hide</button>
        </div>
      )}
      <SourceStrip nav={nav} />
      <div className="statline">
        <button onClick={() => nav.tab("log", "turnouts")}><b className="hot">{turnoutsToday}</b> turnouts today</button>
        <button onClick={() => nav.tab("appliances", "out")}><b>{outCount}</b> out now</button>
        <button onClick={() => nav.tab("log", "priority")}><b className={priorityToday ? "prio" : ""}>{priorityToday}</b> priority</button>
        <span className="spacer" />
        <button className="btn mapbtn" aria-pressed={showMap} onClick={() => store.settings({ showMap: !showMap })}>
          {showMap ? "Hide map" : "Show map"}
        </button>
      </div>

      <div className={`live${showMap ? " with-map" : ""}`}>
        <div className="col-main">
          <section className="panel">
            <h2>Turnouts <small>{jobs.length ? `latest ${ago(jobs[0].start, now)}` : ""}</small></h2>
            {jobs.length === 0 ? <p className="empty">No turnouts heard yet. They'll appear here as soon as a station is called.</p> : (
              <div className="jobs">
                {jobs.slice(0, 10).map((j) => <JobCard key={j.id} job={j} ix={ix} board={board} now={now} watched={watched} nav={nav} />)}
              </div>
            )}
            {jobs.length > 10 && <button className="linkbtn small" onClick={() => nav.tab("log", "turnouts")}>Older turnouts in the log</button>}
          </section>
        </div>
        {showMap && <div className="col-map"><MapView board={board} ix={ix} recentMs={recentMs} now={now} onSelect={nav.station} /></div>}

        <div className="col-side">
          <StatusBoard ix={ix} board={board} now={now} nav={nav} />
          <OnAir events={events} now={now} nav={nav} />
          {lastEv && <LastCall ev={lastEv} name={lastEv.applianceId ? applianceName(ix, ix.appliance.get(lastEv.applianceId)!) : lastEv.title} />}
        </div>
      </div>
    </>
  );
}

function JobCard({ job, ix, board, now, watched, nav }: { job: Job; ix: Index; board: ReturnType<typeof useBoard>["board"]; now: number; watched: string[]; nav: Nav }) {
  const fresh = now - job.last < 10_000;
  const isWatched = job.stationIds.some((s) => watched.includes(s));
  return (
    <article className={`job${job.active ? " active" : ""}${fresh ? " fresh" : ""}${isWatched ? " watched" : ""}`}>
      <div className="job-head">
        <div className="job-stations">
          {job.stationIds.map((sid, i) => (
            <span key={sid}>{i > 0 && <span className="muted"> + </span>}
              <button className="linkbtn job-st" onClick={() => nav.station(sid)}>{isWatched && watched.includes(sid) ? "★ " : ""}{ix.station.get(sid)?.name ?? sid}</button>
            </span>
          ))}
        </div>
        <span className="job-time" title={clockTime(job.start)}>{ago(job.start, now)}</span>
      </div>
      <div className="job-units">
        {job.applianceIds.map((id) => {
          const a = ix.appliance.get(id), ab = board.appliances.get(id), st = ab?.state ?? "not-heard";
          return a && (
            <button key={id} className="chipunit" style={{ borderColor: stateVar(st) }} onClick={() => nav.appliance(id)}>
              <b>{a.callsign}</b><span style={{ color: stateVar(st) }}>{ab ? boardText(ab) : stateText(st)}</span>
            </button>
          );
        })}
      </div>
      <div className="job-foot small muted">
        <span>{job.turnouts.map((t) => <code key={t.call.id}>{t.call.code}</code>)}</span>
        <span>{job.active ? "In progress" : "Appliances back"}</span>
      </div>
    </article>
  );
}

function StatusBoard({ ix, board, now, nav }: { ix: Index; board: ReturnType<typeof useBoard>["board"]; now: number; nav: Nav }) {
  const rows = [...board.appliances.entries()];
  const groups = BOARD_GROUPS.map(([state, label]) => ({
    state, label,
    units: rows.filter(([, b]) => b.state === state).sort((a, b) => (b[1].lastHeard ?? 0) - (a[1].lastHeard ?? 0)),
  })).filter((g) => g.units.length);
  return (
    <section className="panel">
      <h2>Status board <button className="linkbtn small" onClick={() => nav.tab("appliances")}>All appliances</button></h2>
      {groups.length === 0 ? <p className="empty">Every appliance heard from is on station.</p> : groups.map((g) => (
        <div key={g.state} className="sb-group">
          <div className="sb-head"><i className="dot" style={{ background: stateVar(g.state) }} />{g.label}<span className="muted">{g.units.length}</span></div>
          <div className="sb-units">
            {g.units.map(([id, b]) => {
              const a = ix.appliance.get(id)!;
              return (
                <button key={id} className="sb-unit" style={{ ["--c" as string]: stateVar(g.state) }} onClick={() => nav.appliance(id)} title={`${ix.station.get(a.stationId)?.name} ${a.callsign}`}>
                  <b>{a.callsign}</b>
                  <span>{ix.station.get(a.stationId)?.name}</span>
                  <span className="mono">{ago(b.lastHeard, now).replace(" ago", "")}{b.priorityAt && now - b.priorityAt < 30 * 60_000 ? " · PRIORITY" : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

const AIR_FILTERS: [string, string, (e: Interpreted) => boolean][] = [
  ["all", "All", (e) => e.type !== "turnout" && e.type !== "unreadable"],
  ["routine", "Routine", (e) => e.type === "appliance-call"],
  ["priority", "Priority", (e) => e.type === "priority"],
  ["status", "Status", (e) => e.type === "status" || e.type === "unknown-status"],
];

/** Who's been on the radio: status messages, routine and priority calls. */
function OnAir({ events, now, nav }: { events: Interpreted[]; now: number; nav: Nav }) {
  const [f, setF] = useState("all");
  const test = AIR_FILTERS.find((x) => x[0] === f)![2];
  const shown = events.filter(test).slice(-10).reverse();
  return (
    <section className="panel">
      <h2>On air <button className="linkbtn small" onClick={() => nav.tab("log")}>Full log</button></h2>
      <div className="chips" role="group" aria-label="Filter calls">
        {AIR_FILTERS.map(([k, label]) => <button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{label}</button>)}
      </div>
      {shown.length === 0 ? <p className="empty">Nothing heard yet.</p> : (
        <ul className="list">{shown.map((e) => <LogItem key={e.call.id} ev={e} now={now} onOpen={() => openEvent(e, nav)} />)}</ul>
      )}
    </section>
  );
}

/** One line saying where calls come from, with the one action that matters. */
function SourceStrip({ nav }: { nav: Nav }) {
  const mode = useStore((s) => s.settings.mode);
  const sim = useStore((s) => s.settings.sim);
  const input = useStore((s) => s.input);
  const player = useStore((s) => s.player);
  const conn = useStore((s) => s.connection);
  const settings = () => nav.tab("data", "source");
  let body;
  if (mode === "demo") {
    body = <><span className="src-dot demo" /><span className="grow"><b>Demo traffic</b> <span className="muted">· {sim.speed}× speed</span></span>
      <button className="btn" onClick={() => { demoActions.unlockAudio(); demoActions.turnout(); }}>Simulate</button></>;
  } else if (mode === "input") {
    const on = input?.status === "listening";
    body = <><span className={`src-dot${on ? " on" : ""}`} /><span className="grow"><b>{on ? "Listening" : "Audio input off"}</b>
      {on && <span className="mini-level"><i style={{ width: `${Math.round((input?.level ?? 0) * 100)}%` }} /></span>}</span>
      {on ? <button className="btn" onClick={() => inputActions.pause()}>Stop</button>
        : <button className="btn primary" onClick={() => void inputActions.listen()}>Start listening</button>}</>;
  } else if (mode === "file") {
    body = <><span className="src-dot file" /><span className="grow"><b>Recording</b> <span className="muted">· {player?.name ?? "no file open"}</span></span>
      <button className="btn" onClick={settings}>{player ? "Open another" : "Open a file"}</button></>;
  } else {
    body = <><span className={`src-dot${conn.status === "live" ? " on" : ""}`} /><span className="grow"><b>{conn.status === "live" ? "Live from the backend" : "Backend: " + conn.status}</b></span></>;
  }
  return (
    <div className="srcstrip">
      {body}
      <button className="iconbtn" onClick={settings} aria-label="Radio source settings" title="Radio source settings">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--panel)" /><circle cx="15" cy="12" r="2" fill="var(--panel)" /><circle cx="7" cy="18" r="2" fill="var(--panel)" /></svg>
      </button>
    </div>
  );
}

export function openEvent(e: Interpreted, nav: Nav) {
  if (e.applianceId) nav.appliance(e.applianceId);
  else if (e.stationId) nav.station(e.stationId);
  else if (e.type === "unknown-code" || e.type === "unknown-status") nav.tab("data", "inbox");
}

export function LogItem({ ev, now, onOpen, absolute }: { ev: Interpreted; now: number; onOpen?: () => void; absolute?: boolean }) {
  const pct = ev.call.code ? ` · ${Math.round(ev.call.confidence * 100)}%` : "";
  return (
    <li>
      <button className={`item${now - ev.call.time < 6000 ? " fresh" : ""}`} onClick={onOpen}>
        <span className="t">{absolute ? clockTime(ev.call.time) : ago(ev.call.time, now).replace(" ago", "")}</span>
        <span className="what"><b>{ev.title}</b><span>{ev.type === "status" || ev.type === "appliance-call" || ev.type === "priority" ? `${ev.label} · ` : ""}<code>{ev.call.code || "—"}</code>{pct}</span></span>
        <EventPill ev={ev} />
      </button>
    </li>
  );
}

function LastCall({ ev, name }: { ev: Interpreted; name: string }) {
  const c = ev.call;
  return (
    <details className="panel lastcall">
      <summary><span className="section-title">Last decode <small>{c.code || "no tones"} · {Math.round(c.confidence * 100)}%</small></span></summary>
      <div><b>{name}</b> <span className="muted">· {ev.label}</span></div>
      {c.slots && <ToneStrip slots={c.slots} long={c.kind === "appliance-msg"} />}
      {c.sent && <div className="small muted">Sent <code>{c.sent}</code> · {c.sent === c.code ? "decoded exactly" : c.confidence < 0.5 ? "too noisy to trust" : "decoded differently"}</div>}
      <div className={`meter${c.confidence < 0.5 ? " low" : ""}`}><i style={{ width: `${Math.round(c.confidence * 100)}%` }} /></div>
      <div className="small muted">From {c.source === "demo" ? "synthesised demo audio" : c.source === "file" ? "the recording" : c.source === "input" ? "the audio input" : "the radio"}</div>
    </details>
  );
}

