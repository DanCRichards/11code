import { useState } from "react";
import { useStore } from "../store";

/**
 * Choose trucks (and optionally whole stations). Each station row has a
 * whole-station control; expanding it lists its trucks.
 */
export function UnitPicker({ appliances, stations, onChange, stationMode }: {
  appliances: string[];
  stations?: string[];
  onChange: (next: { appliances: string[]; stations: string[] }) => void;
  /** "toggle" = select the station itself (alarm); "add-all" = add/remove all its trucks (board). */
  stationMode: "toggle" | "add-all";
}) {
  const cb = useStore((s) => s.codebook);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const st = stations ?? [];
  const n = q.trim().toLowerCase();
  const rows = [...cb.stations].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
    s, apps: cb.appliances.filter((a) => a.stationId === s.id).sort((a, b) => a.callsign.localeCompare(b.callsign, undefined, { numeric: true })),
  })).filter(({ s, apps }) => !n || s.name.toLowerCase().includes(n) || s.number.includes(n) || apps.some((a) => a.callsign.includes(n)));

  const setApps = (next: string[]) => onChange({ appliances: next, stations: st });
  const toggleApp = (id: string) => setApps(appliances.includes(id) ? appliances.filter((x) => x !== id) : [...appliances, id]);

  return (
    <div className="picker">
      <input className="search" type="search" placeholder="Search station or truck" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stations and trucks" />
      <ul className="list">
        {rows.map(({ s, apps }) => {
          const chosen = apps.filter((a) => appliances.includes(a.id)).length;
          const all = apps.length > 0 && chosen === apps.length;
          const expanded = open === s.id || !!n;
          const stationOn = stationMode === "toggle" ? st.includes(s.id) : all;
          return (
            <li key={s.id}>
              <div className="pick-row">
                <button className="pick-name" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={expanded}>
                  <span className="caret">{expanded ? "▾" : "▸"}</span>
                  <b>{s.name}</b>
                  <span className="muted small">{chosen ? `${chosen} of ${apps.length} trucks` : `${apps.length} truck${apps.length === 1 ? "" : "s"}`}</span>
                </button>
                <button className="btn pick-all" aria-pressed={stationOn} disabled={stationMode === "add-all" && !apps.length}
                  onClick={() => {
                    if (stationMode === "toggle") {
                      onChange({ appliances, stations: st.includes(s.id) ? st.filter((x) => x !== s.id) : [...st, s.id] });
                    } else {
                      const ids = apps.map((a) => a.id);
                      setApps(all ? appliances.filter((x) => !ids.includes(x)) : [...appliances, ...ids.filter((x) => !appliances.includes(x))]);
                    }
                  }}>
                  {stationMode === "toggle" ? (stationOn ? "Whole station ✓" : "Whole station") : (all ? "Remove all" : "Add all")}
                </button>
              </div>
              {expanded && apps.length > 0 && (
                <div className="pick-apps">
                  {apps.map((a) => (
                    <label key={a.id} className="pick-app">
                      <input type="checkbox" checked={appliances.includes(a.id)} onChange={() => toggleApp(a.id)} />
                      <b>{a.callsign}</b>
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
