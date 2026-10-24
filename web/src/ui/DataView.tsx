import { useEffect, useMemo, useState, type ReactNode } from "react";
import { STATE_LABEL, type InboxItem } from "../core/derive";
import { applianceName } from "../core/interpret";
import type { Appliance, ApplianceState, CallType, Codebook, Station, StatusCode, TurnoutCode } from "../core/types";
import { validateCodebook } from "../core/validate";
import { resetLocalCodebook, saveCodebook, startSource } from "../sources/controller";
import { BUNDLED, store, useStore } from "../store";
import { ago, Sheet, useBoard } from "./common";
import { askNotifications, chime, testSound, unlockAlertAudio } from "./alerts";
import { DemoRadio } from "./DemoRadio";
import { InputPanel } from "./Input";
import { ImportPanel } from "./Player";
import { UnitPicker } from "./Picker";

type Sub = "source" | "alerts" | "inbox" | "stations" | "appliances" | "codes" | "messages" | "backup";
type Section = "source" | "alerts" | "inbox" | "codebook" | "backup";
const CODEBOOK_SUBS: [Sub, string][] = [["stations", "Stations"], ["appliances", "Trucks"], ["codes", "Turnout codes"], ["messages", "Message meanings"]];
const sectionOf = (sub?: string): Section | null =>
  sub === "source" || sub === "alerts" || sub === "inbox" || sub === "backup" ? sub
    : sub === "stations" || sub === "appliances" || sub === "codes" || sub === "messages" || sub === "codebook" ? "codebook" : null;
const STATES: ApplianceState[] = ["turned-out", "responding", "at-incident", "out-of-area", "available-radio", "on-station", "status-unknown"];
const clone = (cb: Codebook): Codebook => JSON.parse(JSON.stringify(cb));
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Apply an edit to a copy of the codebook and save it (locally or to the backend). */
function useEdit() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const edit = async (change: (cb: Codebook) => void, done = "Saved."): Promise<boolean> => {
    const next = clone(store.get().codebook);
    change(next);
    setBusy(true);
    try {
      await saveCodebook(next);
      setMsg({ ok: true, text: done });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { edit, busy, msg, setMsg };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <div className={msg.ok ? "okmsg" : "error"} role="status">{msg.text}</div> : null;
}

export function DataView({ sub: initial }: { sub?: string }) {
  const [section, setSection] = useState<Section | null>(sectionOf(initial));
  const [codebookSub, setCodebookSub] = useState<Sub>(CODEBOOK_SUBS.some((c) => c[0] === initial) ? (initial as Sub) : "stations");
  const open = (s: Section | null) => { setSection(s); window.scrollTo({ top: 0 }); };
  if (!section) return <SettingsHome open={open} />;
  const titles: Record<Section, string> = {
    source: "Source", alerts: "Alerts", inbox: "Unknown codes", codebook: "Codebook", backup: "Import / export",
  };
  return (
    <>
      <button className="backlink" onClick={() => open(null)}>‹ Settings</button>
      <h1 className="page-title">{titles[section]}</h1>
      {section === "source" && <SourcePanel />}
      {section === "alerts" && <AlertsPanel />}
      {section === "inbox" && <Inbox />}
      {section === "backup" && <Backup />}
      {section === "codebook" && (
        <>
          <div className="subtabs" role="tablist">
            {CODEBOOK_SUBS.map(([key, label]) => (
              <button key={key} role="tab" className="chip" aria-pressed={codebookSub === key} onClick={() => setCodebookSub(key)}>{label}</button>
            ))}
          </div>
          {codebookSub === "stations" && <StationsEditor />}
          {codebookSub === "appliances" && <AppliancesEditor />}
          {codebookSub === "codes" && <CodesEditor />}
          {codebookSub === "messages" && <MessagesEditor />}
        </>
      )}
    </>
  );
}

/** Settings landing page: a plain list, each row showing its current value. */
function SettingsHome({ open }: { open: (s: Section) => void }) {
  const st = useStore((s) => s.settings);
  const cb = useStore((s) => s.codebook);
  const origin = useStore((s) => s.codebookOrigin);
  const input = useStore((s) => s.input);
  const { board } = useBoard();
  const [setup, setSetup] = useState(false);
  const name = (id: string) => cb.stations.find((s) => s.id === id)?.name ?? id;
  const source = st.mode === "demo" ? `Demo, ${st.sim.speed}×`
    : st.mode === "input" ? (input?.status === "listening" ? "Audio input" : "Audio input (off)")
    : st.mode === "file" ? "Recording" : st.backendUrl || "Backend";
  const alarmCount = st.alarm.stations.length + st.alarm.appliances.length;
  const alerts = [alarmCount ? `Turnout ${alarmCount}` : "Turnout off", `priority ${st.priorityAlarm.scope === "off" ? "off" : st.priorityAlarm.scope === "any" ? "all" : "chosen"}`].join(", ");
  const mine = [...new Set([...st.watched, ...st.alarm.stations])];
  const row = (label: string, value: ReactNode, onClick: () => void) => (
    <button className="set-row" onClick={onClick}><span>{label}</span><span className="set-val">{value}</span><span className="chev" aria-hidden="true">›</span></button>
  );
  return (
    <>
      <h1 className="page-title">Settings</h1>
      <div className="set-group">
        {row("My station", mine.length ? mine.map(name).join(", ") : "Not set", () => setSetup(true))}
        {row("Source", source, () => open("source"))}
        {row("Alerts", alerts, () => open("alerts"))}
      </div>
      <div className="set-group">
        {row("Unknown codes", board.inbox.length ? <span className="badge static">{board.inbox.length}</span> : "None", () => open("inbox"))}
        {row("Codebook", `${cb.stations.length} stations, ${cb.appliances.length} trucks${origin === "local" ? " (edited)" : origin === "backend" ? " (shared)" : ""}`, () => open("codebook"))}
        {row("Import / export", "", () => open("backup"))}
      </div>
      <div className="set-group">
        {row("Tone quiz", "", () => { location.hash = "quiz"; })}
      </div>
      {setup && <QuickSetup close={() => setSetup(false)} />}
    </>
  );
}

/** Pick your station(s)/trucks once; fills My board, the turnout alarm and watched stations. */
function QuickSetup({ close }: { close: () => void }) {
  const st = useStore((s) => s.settings);
  const cb = useStore((s) => s.codebook);
  const [apps, setApps] = useState<string[]>(st.myBoard.appliances);
  const [alarm, setAlarm] = useState(true);
  const stations = [...new Set(apps.map((id) => cb.appliances.find((a) => a.id === id)?.stationId).filter(Boolean) as string[])];
  const apply = () => {
    store.myBoard({ appliances: apps });
    store.settings({ watched: [...new Set([...st.watched, ...stations])] });
    if (alarm) store.alarm({ appliances: apps });
    close();
  };
  return (
    <Sheet title="My station" onClose={close}>
      <UnitPicker stationMode="add-all" appliances={apps} onChange={(n) => setApps(n.appliances)} />
      <label className="check"><input type="checkbox" checked={alarm} onChange={(e) => setAlarm(e.target.checked)} /> Turnout alarm for these trucks</label>
      <div className="row">
        <button className="btn primary" disabled={!apps.length} onClick={apply}>Save {apps.length ? `${apps.length} truck${apps.length === 1 ? "" : "s"}` : ""}</button>
        <span className="small muted">{stations.length ? `${stations.map((id) => cb.stations.find((s) => s.id === id)?.name).join(", ")}` : ""}</span>
      </div>
    </Sheet>
  );
}

// ---- inbox ---------------------------------------------------------------

function Inbox() {
  const { board, ix, now } = useBoard();
  const dismissed = useStore((s) => s.settings.dismissed);
  if (!board.inbox.length) {
    return <section className="panel"><p className="empty">No unknown codes.</p></section>;
  }
  return (
    <div className="feeds">
      {board.inbox.map((item) => <InboxCard key={item.key} item={item} now={now} ixName={(id) => {
        const a = ix.appliance.get(id);
        return a ? applianceName(ix, a) : id;
      }} onDismiss={() => store.settings({ dismissed: [...dismissed, item.key] })} />)}
      {dismissed.length > 0 && <button className="linkbtn small" onClick={() => store.settings({ dismissed: [] })}>Show {dismissed.length} dismissed code{dismissed.length === 1 ? "" : "s"} again</button>}
    </div>
  );
}

function InboxCard({ item, now, ixName, onDismiss }: { item: InboxItem; now: number; ixName: (id: string) => string; onDismiss: () => void }) {
  const cb = useStore((s) => s.codebook);
  const { edit, busy, msg } = useEdit();
  const [stationId, setStationId] = useState(item.suggestion?.stationId ?? "");
  const [applianceId, setApplianceId] = useState(item.suggestion?.applianceId ?? "");
  const [status, setStatus] = useState<{ label: string; kCode: string; state: ApplianceState }>({ label: "", kCode: "", state: "status-unknown" });
  const heading = item.what === "station-code" ? `Turnout code ${item.code}`
    : item.what === "unit" ? `Unit ID ${item.code}` : `Message ${item.code}`;
  const sub = `${item.count}× · last ${ago(item.last, now)}${item.what === "status" && item.applianceId ? ` · from ${ixName(item.applianceId)}` : ""}${item.example !== item.code ? ` · e.g. ${item.example}` : ""}`;

  const addCode = (sid: string, aid: string | null) => edit((c) => {
    c.turnoutCodes.push({ code: item.code, stationId: sid, applianceId: aid, source: "user" });
  }, `Added ${item.code}.`);

  return (
    <section className="panel">
      <h2>{heading}<small>{sub}</small></h2>
      {item.what === "station-code" && (
        <>
          {item.suggestion && (
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => addCode(item.suggestion!.stationId, item.suggestion!.applianceId)}>
                Assign to {item.suggestion.applianceId ? ixName(item.suggestion.applianceId) : `${cb.stations.find((s) => s.id === item.suggestion!.stationId)?.name} station`}
              </button>
              <span className="small muted">Suggested: {item.suggestion.reason}</span>
            </div>
          )}
          <div className="cols2">
            <label className="field"><span>Station</span>
              <select value={stationId} onChange={(e) => { setStationId(e.target.value); setApplianceId(""); }}>
                <option value="">Choose…</option>
                {[...cb.stations].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
            <label className="field"><span>Appliance</span>
              <select value={applianceId} onChange={(e) => setApplianceId(e.target.value)} disabled={!stationId}>
                <option value="">None: the station acknowledging</option>
                {cb.appliances.filter((a) => a.stationId === stationId).map((a) => <option key={a.id} value={a.id}>{a.callsign}</option>)}
              </select></label>
          </div>
          <div className="row"><button className="btn" disabled={!stationId || busy} onClick={() => addCode(stationId, applianceId || null)}>Add code</button>
            <button className="btn" onClick={onDismiss}>Dismiss</button></div>
        </>
      )}
      {item.what === "unit" && (
        <>
          <p className="note">Appliance for unit ID <code>{item.code}</code>:</p>
          <label className="field"><span>Appliance</span>
            <select value={applianceId} onChange={(e) => setApplianceId(e.target.value)}>
              <option value="">Choose…</option>
              {[...cb.appliances].sort((a, b) => Number(a.selcallVerified) - Number(b.selcallVerified) || a.callsign.localeCompare(b.callsign))
                .map((a) => <option key={a.id} value={a.id}>{a.callsign} · {cb.stations.find((s) => s.id === a.stationId)?.name}{a.selcallVerified ? ` (has ${a.selcallId})` : ""}</option>)}
            </select></label>
          <div className="row">
            <button className="btn primary" disabled={!applianceId || busy} onClick={() => edit((c) => {
              const a = c.appliances.find((x) => x.id === applianceId)!;
              a.selcallId = item.code;
              a.selcallVerified = true;
            }, `${item.code} assigned.`)}>Assign ID</button>
            <button className="btn" onClick={onDismiss}>Dismiss</button>
          </div>
        </>
      )}
      {item.what === "status" && (
        <>
          <p className="note">Meaning of <code>{item.code}</code>:</p>
          <div className="cols2">
            <label className="field"><span>Label</span><input value={status.label} onChange={(e) => setStatus({ ...status, label: e.target.value })} placeholder="e.g. Responding" /></label>
            <label className="field"><span>K-code</span><input value={status.kCode} onChange={(e) => setStatus({ ...status, kCode: e.target.value })} placeholder="e.g. K1" /></label>
          </div>
          <label className="field"><span>Sets appliance to</span>
            <select value={status.state} onChange={(e) => setStatus({ ...status, state: e.target.value as ApplianceState })}>
              {STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
            </select></label>
          <div className="row">
            <button className="btn primary" disabled={!status.label || busy} onClick={() => edit((c) => {
              c.statusCodes.push({ suffix: item.code, ...status });
            }, `Meaning saved for ${item.code}.`)}>Save meaning</button>
            <button className="btn" onClick={onDismiss}>Dismiss</button>
          </div>
        </>
      )}
      <Msg msg={msg} />
    </section>
  );
}

// ---- generic list + edit sheet -------------------------------------------

function ListEditor<T>({ title, items, keyOf, render, search, onAdd, addLabel, editor }: {
  title: string; items: T[]; keyOf: (t: T) => string; render: (t: T) => ReactNode; search: (t: T) => string;
  onAdd?: () => void; addLabel?: string; editor: (t: T | null, close: () => void) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<T | null | undefined>(undefined);
  const n = q.toLowerCase();
  const shown = items.filter((t) => !n || search(t).toLowerCase().includes(n));
  return (
    <>
      <div className="row">
        <input className="search grow" style={{ flex: "1 1 200px" }} type="search" placeholder={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title}`} />
        <button className="btn primary" onClick={() => (onAdd ? onAdd() : setOpen(null))}>{addLabel ?? "Add"}</button>
      </div>
      <section className="panel">
        <span className="muted small">{shown.length} of {items.length}</span>
        <ul className="list">
          {shown.map((t) => (
            <li key={keyOf(t)}><button className="item" onClick={() => setOpen(t)}>{render(t)}</button></li>
          ))}
        </ul>
      </section>
      {open !== undefined && editor(open, () => setOpen(undefined))}
    </>
  );
}

function StationsEditor() {
  const cb = useStore((s) => s.codebook);
  return (
    <ListEditor<Station> title="Stations" items={[...cb.stations].sort((a, b) => a.name.localeCompare(b.name))}
      keyOf={(s) => s.id} search={(s) => `${s.name} ${s.number}`} addLabel="Add station"
      render={(s) => (<>
        <span className="callsign muted" style={{ fontSize: 18 }}>{s.number || "–"}</span>
        <span className="what"><b>{s.name}</b><span>{cb.appliances.filter((a) => a.stationId === s.id).map((a) => a.callsign).join(", ") || "No appliances"}</span></span>
        <span className="small muted mono">{s.lat.toFixed(3)}, {s.lon.toFixed(3)}</span>
      </>)}
      editor={(s, close) => <StationForm station={s} close={close} />} />
  );
}

function StationForm({ station, close }: { station: Station | null; close: () => void }) {
  const cb = useStore((s) => s.codebook);
  const [f, setF] = useState<Station>(station ?? { id: "", name: "", number: "", lat: -36.85, lon: 174.76 });
  const { edit, busy, msg } = useEdit();
  const inUse = station ? cb.appliances.some((a) => a.stationId === station.id) || cb.turnoutCodes.some((c) => c.stationId === station.id) : false;
  const save = async () => {
    const ok = await edit((c) => {
      const next = { ...f, id: f.id || slug(f.name), lat: Number(f.lat), lon: Number(f.lon) };
      if (station) c.stations = c.stations.map((x) => (x.id === station.id ? next : x));
      else c.stations.push(next);
    });
    if (ok) close();
  };
  return (
    <Sheet title={station ? `Edit ${station.name}` : "New station"} onClose={close}>
      <div className="form">
        <label className="field"><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Station number (used in turnout codes: 182 + number + 0)</span><input value={f.number} inputMode="numeric" onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
        <div className="cols2">
          <label className="field"><span>Latitude</span><input value={f.lat} inputMode="decimal" onChange={(e) => setF({ ...f, lat: e.target.value as unknown as number })} /></label>
          <label className="field"><span>Longitude</span><input value={f.lon} inputMode="decimal" onChange={(e) => setF({ ...f, lon: e.target.value as unknown as number })} /></label>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!f.name || busy} onClick={save}>Save</button>
          {station && <button className="btn danger" disabled={busy || inUse} title={inUse ? "Move or delete its appliances and codes first" : ""}
            onClick={async () => { if (await edit((c) => { c.stations = c.stations.filter((x) => x.id !== station.id); }, "Deleted.")) close(); }}>Delete</button>}
        </div>
        {inUse && <p className="note">Remove its appliances and codes before deleting.</p>}
        <Msg msg={msg} />
      </div>
    </Sheet>
  );
}

function AppliancesEditor() {
  const cb = useStore((s) => s.codebook);
  const name = (sid: string) => cb.stations.find((s) => s.id === sid)?.name ?? sid;
  return (
    <ListEditor<Appliance> title="Appliances" items={[...cb.appliances].sort((a, b) => a.callsign.localeCompare(b.callsign, undefined, { numeric: true }))}
      keyOf={(a) => a.id} search={(a) => `${a.callsign} ${name(a.stationId)} ${a.selcallId} ${a.type}`} addLabel="Add appliance"
      render={(a) => (<>
        <span className="callsign">{a.callsign}</span>
        <span className="what"><b>{name(a.stationId)}</b><span>{a.type || "Appliance"}</span></span>
        <span className="small"><code>{a.selcallId || "—"}</code>{!a.selcallVerified && <span className="tag">placeholder</span>}</span>
      </>)}
      editor={(a, close) => <ApplianceForm app={a} close={close} />} />
  );
}

function ApplianceForm({ app, close }: { app: Appliance | null; close: () => void }) {
  const cb = useStore((s) => s.codebook);
  const [f, setF] = useState<Appliance>(app ?? { id: "", callsign: "", stationId: "", type: "", selcallId: "", selcallVerified: false });
  const { edit, busy, msg } = useEdit();
  const save = async () => {
    const ok = await edit((c) => {
      const next = { ...f, id: f.id || f.callsign, selcallId: f.selcallId.toUpperCase() };
      if (app) c.appliances = c.appliances.map((x) => (x.id === app.id ? next : x));
      else c.appliances.push(next);
    });
    if (ok) close();
  };
  return (
    <Sheet title={app ? `Edit ${app.callsign}` : "New appliance"} onClose={close}>
      <div className="form">
        <div className="cols2">
          <label className="field"><span>Callsign</span><input value={f.callsign} disabled={!!app} onChange={(e) => setF({ ...f, callsign: e.target.value })} /></label>
          <label className="field"><span>Type</span><input value={f.type} placeholder="e.g. Pump Rescue Tender" onChange={(e) => setF({ ...f, type: e.target.value })} /></label>
        </div>
        <label className="field"><span>Station</span>
          <select value={f.stationId} onChange={(e) => setF({ ...f, stationId: e.target.value })}>
            <option value="">Choose…</option>
            {[...cb.stations].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="field"><span>Selcall ID (5 tones, e.g. D8611)</span><input className="mono" value={f.selcallId} maxLength={5} onChange={(e) => setF({ ...f, selcallId: e.target.value.toUpperCase() })} /></label>
        <label className="check"><input type="checkbox" checked={f.selcallVerified} onChange={(e) => setF({ ...f, selcallVerified: e.target.checked })} /> Selcall ID confirmed from a real recording</label>
        <div className="row">
          <button className="btn primary" disabled={!f.callsign || !f.stationId || busy} onClick={save}>Save</button>
          {app && <button className="btn danger" disabled={busy} onClick={async () => {
            if (await edit((c) => {
              c.appliances = c.appliances.filter((x) => x.id !== app.id);
              c.turnoutCodes = c.turnoutCodes.filter((t) => t.applianceId !== app.id);
            }, "Deleted.")) close();
          }}>Delete (and its turnout codes)</button>}
        </div>
        <Msg msg={msg} />
      </div>
    </Sheet>
  );
}

function CodesEditor() {
  const cb = useStore((s) => s.codebook);
  const name = (t: TurnoutCode) => {
    const s = cb.stations.find((x) => x.id === t.stationId)?.name ?? t.stationId;
    return t.applianceId ? `${s} ${cb.appliances.find((a) => a.id === t.applianceId)?.callsign ?? t.applianceId}` : `${s} (acknowledgement)`;
  };
  return (
    <ListEditor<TurnoutCode> title="Turnout codes" items={cb.turnoutCodes} keyOf={(t) => t.code}
      search={(t) => `${t.code} ${name(t)}`} addLabel="Add code"
      render={(t) => (<>
        <code style={{ fontSize: 15, fontWeight: 600 }}>{t.code}</code>
        <span className="what"><b>{name(t)}</b><span>{t.source === "list" ? "From Store/stations.lst" : t.source === "pattern" ? "Filled in from the 182 pattern" : "Added by hand"}</span></span>
        {t.source === "pattern" ? <span className="tag">unconfirmed</span> : <span />}
      </>)}
      editor={(t, close) => <CodeForm code={t} close={close} />} />
  );
}

function CodeForm({ code, close }: { code: TurnoutCode | null; close: () => void }) {
  const cb = useStore((s) => s.codebook);
  const [f, setF] = useState<TurnoutCode>(code ?? { code: "", stationId: "", applianceId: null, source: "user" });
  const { edit, busy, msg } = useEdit();
  const save = async () => {
    const ok = await edit((c) => {
      const next = { ...f, code: f.code.toUpperCase(), source: code && code.code === f.code ? (f.source === "pattern" ? "user" : f.source) : "user" } as TurnoutCode;
      if (code) c.turnoutCodes = c.turnoutCodes.map((x) => (x.code === code.code ? next : x));
      else c.turnoutCodes.push(next);
      c.turnoutCodes.sort((a, b) => a.code.localeCompare(b.code));
    });
    if (ok) close();
  };
  return (
    <Sheet title={code ? `Edit ${code.code}` : "New turnout code"} onClose={close}>
      <div className="form">
        <label className="field"><span>Code (6 tones)</span><input className="mono" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
        <label className="field"><span>Station</span>
          <select value={f.stationId} onChange={(e) => setF({ ...f, stationId: e.target.value, applianceId: null })}>
            <option value="">Choose…</option>
            {[...cb.stations].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="field"><span>Appliance</span>
          <select value={f.applianceId ?? ""} onChange={(e) => setF({ ...f, applianceId: e.target.value || null })} disabled={!f.stationId}>
            <option value="">None: the station acknowledging</option>
            {cb.appliances.filter((a) => a.stationId === f.stationId).map((a) => <option key={a.id} value={a.id}>{a.callsign}</option>)}
          </select></label>
        {code?.source === "pattern" && <p className="note">Saving marks this code as confirmed.</p>}
        <div className="row">
          <button className="btn primary" disabled={!f.code || !f.stationId || busy} onClick={save}>Save</button>
          {code && <button className="btn danger" disabled={busy} onClick={async () => { if (await edit((c) => { c.turnoutCodes = c.turnoutCodes.filter((x) => x.code !== code.code); }, "Deleted.")) close(); }}>Delete</button>}
        </div>
        <Msg msg={msg} />
      </div>
    </Sheet>
  );
}

function MessagesEditor() {
  const cb = useStore((s) => s.codebook);
  const [openStatus, setOpenStatus] = useState<StatusCode | null | undefined>(undefined);
  const [openType, setOpenType] = useState<CallType | null | undefined>(undefined);
  return (
    <>
      <section className="panel">
        <h2>Status messages <button className="btn" onClick={() => setOpenStatus(null)}>Add</button></h2>
        <p className="note">Suffix after the unit ID in a long message, e.g. <code>D8611-<b>F1A0C2</b></code>.</p>
        <ul className="list">
          {cb.statusCodes.map((s) => (
            <li key={s.suffix}><button className="item" onClick={() => setOpenStatus(s)}>
              <code style={{ fontWeight: 600 }}>{s.suffix}</code>
              <span className="what"><b>{s.kCode ? `${s.kCode} · ` : ""}{s.label}</b><span>Sets {STATE_LABEL[s.state]}</span></span>
              {s.demo ? <span className="tag">demo</span> : <span />}
            </button></li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Short appliance calls <button className="btn" onClick={() => setOpenType(null)}>Add</button></h2>
        <p className="note">Final tone after the unit ID, e.g. <code>C072D<b>2</b></code>.</p>
        <ul className="list">
          {cb.callTypes.map((t) => (
            <li key={t.final}><button className="item" onClick={() => setOpenType(t)}>
              <code style={{ fontWeight: 600, fontSize: 16 }}>{t.final}</code>
              <span className="what"><b>{t.label}</b><span>{t.priority ? "Priority: raises the alert banner" : "Logged only"}</span></span>
              {!t.verified ? <span className="tag">unconfirmed</span> : <span />}
            </button></li>
          ))}
        </ul>
      </section>
      {openStatus !== undefined && <StatusForm item={openStatus} close={() => setOpenStatus(undefined)} />}
      {openType !== undefined && <CallTypeForm item={openType} close={() => setOpenType(undefined)} />}
    </>
  );
}

function StatusForm({ item, close }: { item: StatusCode | null; close: () => void }) {
  const [f, setF] = useState<StatusCode>(item ?? { suffix: "", kCode: "", label: "", state: "status-unknown" });
  const { edit, busy, msg } = useEdit();
  return (
    <Sheet title={item ? `Message ${item.suffix}` : "New status message"} onClose={close}>
      <div className="form">
        <label className="field"><span>Message part (after the "-", e.g. F1A0C2)</span><input className="mono" value={f.suffix} onChange={(e) => setF({ ...f, suffix: e.target.value.toUpperCase() })} /></label>
        <div className="cols2">
          <label className="field"><span>K-code</span><input value={f.kCode} onChange={(e) => setF({ ...f, kCode: e.target.value })} /></label>
          <label className="field"><span>Label</span><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
        </div>
        <label className="field"><span>Sets appliance to</span>
          <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as ApplianceState })}>
            {STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select></label>
        <div className="row">
          <button className="btn primary" disabled={!f.suffix || !f.label || busy} onClick={async () => {
            if (await edit((c) => {
              const next = { ...f, demo: false };
              if (item) c.statusCodes = c.statusCodes.map((x) => (x.suffix === item.suffix ? next : x));
              else c.statusCodes.push(next);
            })) close();
          }}>Save</button>
          {item && <button className="btn danger" disabled={busy} onClick={async () => { if (await edit((c) => { c.statusCodes = c.statusCodes.filter((x) => x.suffix !== item.suffix); }, "Deleted.")) close(); }}>Delete</button>}
        </div>
        <Msg msg={msg} />
      </div>
    </Sheet>
  );
}

function CallTypeForm({ item, close }: { item: CallType | null; close: () => void }) {
  const [f, setF] = useState<CallType>(item ?? { final: "", label: "", priority: false, verified: false });
  const { edit, busy, msg } = useEdit();
  return (
    <Sheet title={item ? `Final tone ${item.final}` : "New call type"} onClose={close}>
      <div className="form">
        <div className="cols2">
          <label className="field"><span>Final tone</span><input className="mono" maxLength={1} value={f.final} onChange={(e) => setF({ ...f, final: e.target.value.toUpperCase() })} /></label>
          <label className="field"><span>Label</span><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.priority} onChange={(e) => setF({ ...f, priority: e.target.checked })} /> Priority call (shows the alert banner)</label>
        <label className="check"><input type="checkbox" checked={f.verified} onChange={(e) => setF({ ...f, verified: e.target.checked })} /> Meaning confirmed</label>
        <div className="row">
          <button className="btn primary" disabled={!f.final || !f.label || busy} onClick={async () => {
            if (await edit((c) => {
              if (item) c.callTypes = c.callTypes.map((x) => (x.final === item.final ? f : x));
              else c.callTypes.push(f);
            })) close();
          }}>Save</button>
          {item && <button className="btn danger" disabled={busy} onClick={async () => { if (await edit((c) => { c.callTypes = c.callTypes.filter((x) => x.final !== item.final); }, "Deleted.")) close(); }}>Delete</button>}
        </div>
        <Msg msg={msg} />
      </div>
    </Sheet>
  );
}

// ---- source + backup -------------------------------------------------------

function SourcePanel() {
  const settings = useStore((s) => s.settings);
  const conn = useStore((s) => s.connection);
  const [url, setUrl] = useState(settings.backendUrl);
  const [key, setKey] = useState(settings.apiKey);
  useEffect(() => { setUrl(settings.backendUrl); }, [settings.backendUrl]);
  const connect = () => { store.settings({ mode: "backend", backendUrl: url.trim(), apiKey: key.trim() }); startSource(); };
  const demo = () => { store.settings({ mode: "demo" }); startSource(); };
  const httpsPage = typeof location !== "undefined" && location.protocol === "https:";
  return (
    <>
      <div className="set-group" role="radiogroup" aria-label="Source">
        {([
          ["demo", "Demo", "Simulated Auckland traffic", demo],
          ["file", "Recording", "Audio file or video", () => { store.settings({ mode: "file" }); startSource(); }],
          ["input", "Audio input", "Scanner via line-in or USB", () => { store.settings({ mode: "input" }); startSource(); }],
          ["backend", "Server", "Live calls from a receiver", connect],
        ] as [string, string, string, () => void][]).map(([m, title, detail, pick]) => (
          <button key={m} className="set-row radio" role="radio" aria-checked={settings.mode === m} onClick={pick}>
            <span className="radio-dot" aria-hidden="true" /><span>{title}</span><span className="set-val">{detail}</span>
          </button>
        ))}
      </div>
      {settings.mode === "demo" && <DemoRadio />}
      {settings.mode === "input" && <InputPanel />}
      {settings.mode === "file" && <ImportPanel />}
      {settings.mode === "backend" && <section className="panel">
        <h2>Server</h2>
        <div className="form">
          <label className="field"><span>Address (blank for this server)</span>
            <input value={url} placeholder="https://firepi.example.nz" onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" /></label>
          <label className="field"><span>Editing key</span>
            <input value={key} type="password" autoComplete="off" onChange={(e) => setKey(e.target.value)} /></label>
          <div className="row">
            <button className="btn primary" onClick={connect}>{settings.mode === "backend" ? "Reconnect" : "Connect"}</button>
            <span className="small">Status: <b>{{ demo: "Demo", file: "Recording", input: "Audio input", connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", error: "Not connected" }[conn.status]}</b></span>
          </div>
          {conn.message && <div className={conn.status === "error" ? "error" : "note"}>{conn.message}</div>}
          {httpsPage && /^http:\/\//.test(url) && !/localhost|127\.0\.0\.1/.test(url) && (
            <p className="error">An https page can't reach an http server. Use https, or open the board from the server's address.</p>
          )}
        </div>
      </section>}
    </>
  );
}

const AUTO_CLEAR: [number, string][] = [[0, "On acknowledge"], [15, "15 s"], [30, "30 s"], [60, "60 s"]];

/** How an alarm goes away: wait for Acknowledge, or clear by itself. */
function AutoClear({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="seg fit" role="group" aria-label={label}>
        {AUTO_CLEAR.map(([v, l]) => <button key={v} aria-pressed={(value || 0) === v} onClick={() => onChange(v)}>{l}</button>)}
      </div>
    </div>
  );
}

function AlertsPanel() {
  const alerts = useStore((s) => s.settings.alerts);
  const alarm = useStore((s) => s.settings.alarm);
  const pa = useStore((s) => s.settings.priorityAlarm);
  const muted = useStore((s) => s.settings.muted);
  const [picking, setPicking] = useState(false);
  const [pickingPrio, setPickingPrio] = useState(false);
  const chosenLabel = (stations: string[], apps: string[]) => [
    ...stations.map((id) => `${cb.stations.find((s) => s.id === id)?.name ?? id} (station)`),
    ...apps.map((id) => { const a = cb.appliances.find((x) => x.id === id); return `${cb.stations.find((s) => s.id === a?.stationId)?.name ?? ""} ${a?.callsign ?? id}`; }),
  ];
  const watched = useStore((s) => s.settings.watched);
  const cb = useStore((s) => s.codebook);
  const [note, setNote] = useState("");
  const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  return (
    <>
      <section className="panel">
        <h2>Chimes</h2>
        <label className="check"><input type="checkbox" checked={alerts.prioritySound} onChange={(e) => { unlockAlertAudio(); store.alertSettings({ prioritySound: e.target.checked }); }} /> Priority calls</label>
        <label className="check"><input type="checkbox" checked={alerts.watchedSound} onChange={(e) => { unlockAlertAudio(); store.alertSettings({ watchedSound: e.target.checked }); }} /> Turnouts at starred stations</label>
        <label className="check"><input type="checkbox" checked={alerts.notify} onChange={async (e) => {
          if (e.target.checked && !(await askNotifications())) { setNote("Notifications are blocked for this site."); return; }
          store.alertSettings({ notify: e.target.checked });
        }} /> Notify when in the background</label>
        <div className="row">
          <button className="btn" onClick={() => testSound("priority-chime", () => chime("priority"))}>Test priority</button>
          <button className="btn" onClick={() => testSound("turnout-chime", () => chime("turnout"))}>Test turnout</button>
        </div>
        {note && <p className="error">{note}</p>}
        {perm === "unsupported" && <p className="note">Notifications aren't available in this browser. On iPhone, add the site to your home screen.</p>}
      </section>
      <section className="panel">
        <h2>Turnout alarm <small>{alarm.stations.length + alarm.appliances.length ? `${alarm.stations.length} station${alarm.stations.length === 1 ? "" : "s"}, ${alarm.appliances.length} truck${alarm.appliances.length === 1 ? "" : "s"}` : "off"}</small></h2>
        {(alarm.stations.length > 0 || alarm.appliances.length > 0) && (
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {alarm.stations.map((id) => <button key={id} className="chip" onClick={() => store.alarm({ stations: alarm.stations.filter((x) => x !== id) })}>{cb.stations.find((s) => s.id === id)?.name} (station) ×</button>)}
            {alarm.appliances.map((id) => {
              const a = cb.appliances.find((x) => x.id === id);
              return <button key={id} className="chip" onClick={() => store.alarm({ appliances: alarm.appliances.filter((x) => x !== id) })}>{cb.stations.find((s) => s.id === a?.stationId)?.name} {a?.callsign} ×</button>;
            })}
          </div>
        )}
        <div className="row">
          <button className="btn primary" onClick={() => setPicking(true)}>{alarm.stations.length + alarm.appliances.length ? "Edit" : "Choose trucks"}</button>
          <button className="btn" onClick={() => testSound("turnout-alarm", () => window.dispatchEvent(new CustomEvent("tb-test-alarm", { detail: "turnout" })))}>Test</button>
        </div>
        <label className="check"><input type="checkbox" checked={alarm.sound} onChange={(e) => store.alarm({ sound: e.target.checked })} /> Siren</label>
        <label className="check"><input type="checkbox" checked={alarm.repeat} onChange={(e) => store.alarm({ repeat: e.target.checked })} /> Repeat until cleared</label>
        <AutoClear value={alarm.autoClear} onChange={(v) => store.alarm({ autoClear: v })} label="Clear" />
        {picking && (
          <Sheet title="Turnout alarm" onClose={() => setPicking(false)}>
            <UnitPicker stationMode="toggle" appliances={alarm.appliances} stations={alarm.stations} onChange={(n) => store.alarm(n)} />
            <div className="row"><button className="btn primary" onClick={() => setPicking(false)}>Done</button></div>
          </Sheet>
        )}
      </section>
      <section className="panel">
        <h2>Priority alarm <small>{pa.scope === "off" ? "off" : pa.scope === "any" ? "any truck" : `${pa.stations.length + pa.appliances.length} chosen`}</small></h2>
        <div className="seg" role="group" aria-label="Priority alarm for">
          <button aria-pressed={pa.scope === "off"} onClick={() => store.priorityAlarm({ scope: "off" })}>Off</button>
          <button aria-pressed={pa.scope === "any"} onClick={() => store.priorityAlarm({ scope: "any" })}>Any truck</button>
          <button aria-pressed={pa.scope === "chosen"} onClick={() => { store.priorityAlarm({ scope: "chosen" }); if (!pa.stations.length && !pa.appliances.length) setPickingPrio(true); }}>Chosen</button>
        </div>
        {pa.scope === "chosen" && (
          <>
            {(pa.stations.length > 0 || pa.appliances.length > 0) && (
              <div className="chips" style={{ flexWrap: "wrap" }}>
                {chosenLabel(pa.stations, pa.appliances).map((l) => <span key={l} className="chip">{l}</span>)}
              </div>
            )}
            <div className="row"><button className="btn" onClick={() => setPickingPrio(true)}>Edit</button></div>
          </>
        )}
        {pa.scope !== "off" && <AutoClear value={pa.autoClear} onChange={(v) => store.priorityAlarm({ autoClear: v })} label="Clear" />}
        <div className="row"><button className="btn" onClick={() => testSound("priority-alarm", () => window.dispatchEvent(new CustomEvent("tb-test-alarm", { detail: "priority" })))}>Test</button></div>
        {pickingPrio && (
          <Sheet title="Priority alarm" onClose={() => setPickingPrio(false)}>
            <UnitPicker stationMode="toggle" appliances={pa.appliances} stations={pa.stations} onChange={(n) => store.priorityAlarm(n)} />
            <div className="row"><button className="btn primary" onClick={() => setPickingPrio(false)}>Done</button></div>
          </Sheet>
        )}
      </section>
      <section className="panel">
        <h2>Unmute on alert <small>{muted ? "radio muted" : "radio on"}</small></h2>
        <div className="seg" role="group" aria-label="Un-mute for">
          {([[0, "Off"], [45, "45 s"], [60, "60 s"]] as [number, string][]).map(([v, l]) => (
            <button key={v} aria-pressed={alerts.unmuteSeconds === v} onClick={() => store.alertSettings({ unmuteSeconds: v })}>{l}</button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Starred stations <small>{watched.length}</small></h2>
        {watched.length === 0 && <p className="note">Star a station from its page.</p>}
        {watched.length > 0 && (
          <ul className="list">
            {watched.map((id) => (
              <li key={id} className="item" style={{ cursor: "default" }}>
                <span className="t">★</span><span className="what"><b>{cb.stations.find((s) => s.id === id)?.name ?? id}</b></span>
                <button className="btn" onClick={() => store.toggleWatch(id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Backup() {
  const cb = useStore((s) => s.codebook);
  const origin = useStore((s) => s.codebookOrigin);
  const json = JSON.stringify(cb, null, 1);
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState("");
  const { edit, busy, msg, setMsg } = useEdit();
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); setCopied("Copied."); } catch { setCopied("Copy blocked here; select the text below instead."); }
  };
  const importIt = async () => {
    let next: Codebook;
    try { next = JSON.parse(paste); } catch { setMsg({ ok: false, text: "That isn't valid JSON." }); return; }
    const problems = validateCodebook({ ...BUNDLED, ...next });
    if (problems.length) { setMsg({ ok: false, text: problems.slice(0, 4).join(" ") }); return; }
    if (await edit((c) => { Object.assign(c, next, { version: c.version }); }, "Imported.")) setPaste("");
  };
  const download = useMemo(() => URL.createObjectURL(new Blob([json], { type: "application/json" })), [json]);
  useEffect(() => () => URL.revokeObjectURL(download), [download]);
  return (
    <>
      <section className="panel">
        <h2>Export <small>{cb.stations.length} stations · {cb.appliances.length} appliances · {cb.turnoutCodes.length} codes</small></h2>
        <div className="row">
          <button className="btn" onClick={copy}>Copy JSON</button>
          <a className="btn" href={download} download="codebook.json" style={{ textDecoration: "none" }}>Download codebook.json</a>
          <span className="small muted">{copied}</span>
        </div>
        <label className="field"><span>Codebook JSON</span><textarea readOnly value={json} /></label>
      </section>
      <section className="panel">
        <h2>Import</h2>
        <label className="field"><span>Paste a codebook JSON to replace the current one</span><textarea value={paste} onChange={(e) => setPaste(e.target.value)} /></label>
        <div className="row">
          <button className="btn primary" disabled={!paste.trim() || busy} onClick={importIt}>Import</button>
          {origin === "local" && <button className="btn danger" onClick={() => { resetLocalCodebook(); setMsg({ ok: true, text: "Back to the bundled codebook." }); }}>Discard local edits</button>}
        </div>
        <Msg msg={msg} />
      </section>
    </>
  );
}
