import { boardText } from "../core/derive";
import { demoActions } from "../sources/controller";
import { store, useStore } from "../store";
import { KCodePicker } from "./KCodePicker";
import { ago, clockTime, EventPill, Sheet, StatePill, stateVar, useBoard } from "./common";
import type { Nav } from "./nav";

export function StationSheet({ id, nav, onClose }: { id: string; nav: Nav; onClose: () => void }) {
  const { ix, board, codebook, now } = useBoard();
  const mode = useStore((s) => s.settings.mode);
  const watched = useStore((s) => s.settings.watched.includes(id));
  const s = ix.station.get(id);
  if (!s) return null;
  const b = board.stations.get(id)!;
  const apps = [...ix.appliance.values()].filter((a) => a.stationId === id);
  const codes = codebook.turnoutCodes.filter((c) => c.stationId === id);
  return (
    <Sheet title={s.name} sub={`Station ${s.number || "number unknown"} · ${b.turnoutsToday} turnout${b.turnoutsToday === 1 ? "" : "s"} today`} onClose={onClose}>
      <button className="btn" aria-pressed={watched} onClick={() => store.toggleWatch(id)}>{watched ? "★ Watching this station" : "☆ Watch this station"}</button>
      <dl className="kv">
        <dt>Last turnout</dt><dd>{b.lastTurnoutEvent ? `${b.lastTurnoutEvent.title}, ${ago(b.lastTurnout, now)}` : "None heard"}</dd>
        <dt>Turnout codes</dt>
        <dd>{codes.length ? codes.map((c) => (
          <div key={c.code}><code>{c.code}</code> {c.applianceId ? `· ${ix.appliance.get(c.applianceId)?.callsign}` : "· station acknowledgement"}{c.source === "pattern" && <span className="tag">from pattern</span>}</div>
        )) : <span className="muted">None known</span>}</dd>
      </dl>
      <h3 className="section-title">Appliances</h3>
      {apps.length === 0 ? <p className="empty">No appliances listed for this station.</p> : (
        <ul className="list">
          {apps.map((a) => {
            const ab = board.appliances.get(a.id)!;
            return (
              <li key={a.id}>
                <button className="item" onClick={() => nav.appliance(a.id)}>
                  <span className="callsign" style={{ color: stateVar(ab.state) }}>{a.callsign}</span>
                  <span className="what"><b>{boardText(ab)}</b><span>{ab.lastHeard ? `heard ${ago(ab.lastHeard, now)}` : "not heard yet"}</span></span>
                  <StatePill state={ab.state} status={ab.status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {mode === "demo" && (
        <div className="row">
          <button className="btn primary" onClick={() => { demoActions.unlockAudio(); demoActions.turnout(id); }}>Simulate a turnout here</button>
        </div>
      )}
      <h3 className="section-title">Recent calls</h3>
      {b.history.length === 0 ? <p className="empty">Nothing heard for this station yet.</p> : (
        <ul className="list">
          {b.history.slice(0, 25).map((e) => (
            <li key={e.call.id}>
              <div className="item" style={{ cursor: "default" }}>
                <span className="t">{clockTime(e.call.time)}</span>
                <span className="what"><b>{e.title}</b><span><code>{e.call.code}</code></span></span>
                <EventPill ev={e} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function ApplianceSheet({ id, nav, onClose }: { id: string; nav: Nav; onClose: () => void }) {
  const { ix, board, codebook, now } = useBoard();
  const a = ix.appliance.get(id);
  if (!a) return null;
  const st = ix.station.get(a.stationId);
  const b = board.appliances.get(id)!;
  const codes = codebook.turnoutCodes.filter((c) => c.applianceId === id);
  return (
    <Sheet title={`${st?.name ?? ""} ${a.callsign}`} sub={<><StatePill state={b.state} status={b.status} /> {b.lastHeard && <span>· {ago(b.lastHeard, now)}</span>}</>} onClose={onClose}>
      <h3 className="section-title">Set K code</h3>
      <KCodePicker applianceId={id} current={b.status?.kCode} />
      <dl className="kv">
        <dt>Station</dt><dd><button className="linkbtn" onClick={() => nav.station(a.stationId)}>{st?.name}</button></dd>
        <dt>Selcall ID</dt><dd><code>{a.selcallId || "unknown"}</code>{!a.selcallVerified && <span className="tag">placeholder</span>}</dd>
        <dt>Turnout code</dt><dd>{codes.length ? codes.map((c) => <code key={c.code} style={{ marginRight: 8 }}>{c.code}</code>) : <span className="muted">None known</span>}</dd>
        {a.type && <><dt>Type</dt><dd>{a.type}</dd></>}
        {b.priorityAt && <><dt>Priority call</dt><dd>{ago(b.priorityAt, now)}</dd></>}
      </dl>
      <h3 className="section-title">Status history</h3>
      {b.history.length === 0 ? <p className="empty">Nothing heard from this appliance yet.</p> : (
        <ul className="list">
          {b.history.slice(0, 40).map((e) => (
            <li key={e.call.id}>
              <div className="item" style={{ cursor: "default" }}>
                <span className="t">{clockTime(e.call.time)}</span>
                <span className="what"><b>{e.label}</b><span><code>{e.call.code}</code> · {Math.round(e.call.confidence * 100)}%</span></span>
                <EventPill ev={e} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
