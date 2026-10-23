import { useState } from "react";
import { isCommitted, nzDay, STATE_LABEL } from "../core/derive";
import { applianceName } from "../core/interpret";
import type { Interpreted } from "../core/types";
import { demoActions } from "../sources/controller";
import { store, useStore } from "../store";
import { ago, clockTime, EventPill, Seg, stateVar, ToneStrip, useBoard } from "./common";
import { MapView } from "./MapView";
import { ImportPanel } from "./Player";
import { InputPanel } from "./Input";
import type { Nav } from "./nav";

export function useWindows() {
  const mode = useStore((s) => s.settings.mode);
  const speed = useStore((s) => s.settings.sim.speed);
  const k = mode === "demo" ? speed : 1;
  return { recentMs: (15 * 60_000) / k, priorityMs: (20 * 60_000) / k };
}

export function LiveView({ nav }: { nav: Nav }) {
  const { ix, events, board, now } = useBoard();
  const mode = useStore((s) => s.settings.mode);
  const lastCall = useStore((s) => s.lastCall);
  const { recentMs, priorityMs } = useWindows();
  const [hiddenPriority, setHiddenPriority] = useState<string>();

  const today = nzDay(now);
  const turnoutsToday = board.turnouts.filter((e) => nzDay(e.call.time) === today).length;
  const out = [...board.appliances.entries()].filter(([, b]) => isCommitted(b.state))
    .sort((a, b) => (b[1].lastHeard ?? 0) - (a[1].lastHeard ?? 0));
  const priorityToday = board.priorities.filter((e) => nzDay(e.call.time) === today).length;
  const prio = board.priorities[0];
  const showPrio = prio && now - prio.call.time < priorityMs && hiddenPriority !== prio.call.id;
  const latest = events.slice(-8).reverse();
  const lastEv = lastCall ? events.find((e) => e.call.id === lastCall.id) : undefined;

  return (
    <div className="live">
      <div className="mapcol">
        {showPrio && (
          <div className="banner" role="alert">
            <div className="grow">
              <b>Priority call</b>
              <div>{prio.title} · {ago(prio.call.time, now)} <span className="mono small">{prio.call.code}</span></div>
            </div>
            <button onClick={() => prio.applianceId && nav.appliance(prio.applianceId)}>View</button>
            <button onClick={() => setHiddenPriority(prio.call.id)} aria-label="Dismiss">Hide</button>
          </div>
        )}
        <div className="tiles">
          <button className="tile hot" onClick={() => nav.tab("log", "turnouts")}><span>Turnouts today</span><b>{turnoutsToday}</b></button>
          <button className="tile" onClick={() => nav.tab("appliances", "out")}><span>Appliances out</span><b>{out.length}</b></button>
          <button className="tile prio" onClick={() => nav.tab("log", "priority")}><span>Priority calls</span><b>{priorityToday}</b></button>
          <button className="tile" onClick={() => nav.tab("data", "inbox")}><span>Unknown codes</span><b>{board.inbox.length}</b></button>
        </div>
        {mode === "input" && <InputPanel />}
        <MapView board={board} ix={ix} recentMs={recentMs} now={now} onSelect={nav.station} />
        {mode === "file" && <ImportPanel />}
        {mode === "demo" && <DemoRadio />}
        {mode === "demo" && <InputPanel compact />}
        {mode === "demo" && <ImportPanel compact />}
      </div>

      <div className="feeds">
        <section className="panel">
          <h2>Recently turned out <small>{board.turnouts.length ? `last ${ago(board.turnouts[0].call.time, now)}` : ""}</small></h2>
          {board.turnouts.length === 0 ? <p className="empty">No turnouts heard yet.</p> : (
            <ul className="list">
              {board.turnouts.slice(0, 8).map((e) => (
                <li key={e.call.id}>
                  <button className={`item${now - e.call.time < 8000 ? " fresh" : ""}`} onClick={() => e.stationId && nav.station(e.stationId)}>
                    <span className="t">{ago(e.call.time, now).replace(" ago", "")}</span>
                    <span className="what"><b>{e.title}</b><span>{e.type === "station-turnout" ? "Whole station" : "Appliance turnout"} · <code>{e.call.code}</code></span></span>
                    <EventPill ev={e} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Appliances out <small>{out.length} committed</small></h2>
          {out.length === 0 ? <p className="empty">Every appliance heard from is available.</p> : (
            <div className="unitgrid">
              {out.slice(0, 18).map(([id, b]) => {
                const a = ix.appliance.get(id)!;
                return (
                  <button key={id} className="unit" style={{ borderLeftColor: stateVar(b.state) }} onClick={() => nav.appliance(id)}>
                    <b>{a.callsign}</b>
                    <span>{ix.station.get(a.stationId)?.name}</span>
                    <span>{STATE_LABEL[b.state]} · {ago(b.lastHeard, now).replace(" ago", "")}</span>
                  </button>
                );
              })}
            </div>
          )}
          {out.length > 18 && <button className="linkbtn" onClick={() => nav.tab("appliances", "out")}>All {out.length} appliances out</button>}
        </section>

        <section className="panel">
          <h2>Latest calls <button className="linkbtn small" onClick={() => nav.tab("log")}>Open log</button></h2>
          <ul className="list">
            {latest.map((e) => <LogItem key={e.call.id} ev={e} now={now} onOpen={() => openEvent(e, nav)} />)}
          </ul>
        </section>

        {lastEv && <LastCall ev={lastEv} name={lastEv.applianceId ? applianceName(ix, ix.appliance.get(lastEv.applianceId)!) : lastEv.title} />}
      </div>
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
        <span className="what"><b>{ev.title}</b><span><code>{ev.call.code || "—"}</code>{pct}</span></span>
        <EventPill ev={ev} />
      </button>
    </li>
  );
}

function LastCall({ ev, name }: { ev: Interpreted; name: string }) {
  const c = ev.call;
  return (
    <section className="panel">
      <h2>Last call decoded <small>{c.source === "demo" ? "from synthesised audio" : c.source === "file" ? "from the recording" : c.source === "input" ? "from the audio input" : "from the radio"}</small></h2>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="readout-code">{c.code || "no tones"}</span>
        <EventPill ev={ev} />
      </div>
      <div><b>{name}</b> <span className="muted">· {ev.label}</span></div>
      {c.slots && <ToneStrip slots={c.slots} long={c.kind === "appliance-msg"} />}
      {c.sent && <div className="small muted">Sent <code>{c.sent}</code> · {c.sent === c.code ? "decoded exactly" : c.confidence < 0.5 ? "too noisy to trust" : "decoded differently"}</div>}
      <div className="row small muted" style={{ justifyContent: "space-between" }}><span>Confidence (weakest tone)</span><b className="mono">{Math.round(c.confidence * 100)}%</b></div>
      <div className={`meter${c.confidence < 0.5 ? " low" : ""}`}><i style={{ width: `${Math.round(c.confidence * 100)}%` }} /></div>
    </section>
  );
}

function DemoRadio() {
  const sim = useStore((s) => s.settings.sim);
  const [msg, setMsg] = useState("");
  return (
    <section className="panel radio" aria-label="Demo radio">
      <h2>Demo radio <small>simulated traffic, decoded from audio</small></h2>
      <div className="row">
        <button className="btn primary" onClick={() => { demoActions.unlockAudio(); setMsg(demoActions.turnout() ? "" : "Every station with a free appliance is busy."); }}>Turn out a station</button>
        <button className="btn" onClick={() => { demoActions.unlockAudio(); demoActions.priority(); }}>Send priority call</button>
        <button className="btn" aria-pressed={sim.auto} onClick={() => store.sim({ auto: !sim.auto })}>Auto traffic</button>
        <button className="btn" aria-pressed={sim.sound} onClick={() => { store.sim({ sound: !sim.sound }); demoActions.unlockAudio(); }}>Sound</button>
      </div>
      {msg && <div className="small muted">{msg}</div>}
      <div className="row"><label>Speed</label>
        <Seg label="Demo speed" value={sim.speed} onChange={(v) => store.sim({ speed: v })} options={[[1, "1×"], [5, "5×"], [20, "20×"], [60, "60×"]]} /></div>
      <div className="row"><label>Signal</label>
        <Seg label="Signal strength" value={sim.snr} onChange={(v) => store.sim({ snr: v })} options={[[25, "Strong"], [8, "Fair"], [2, "Weak"], [-3, "Very weak"]]} /></div>
    </section>
  );
}
