import { useState } from "react";
import type { StatusCode } from "../core/types";
import { setTruckStatus } from "../sources/controller";
import { useStore } from "../store";
import { stateVar } from "./common";

// Codes you wouldn't set by hand; they still show when a truck sends them.
const HIDDEN = new Set(["K0", "KE", "K10", "K11"]);

/** Buttons for every K code in the codebook; tapping one sets the truck to it. */
export function KCodePicker({ applianceId, current, onDone, big = false }: {
  applianceId: string; current?: string; onDone?: () => void; big?: boolean;
}) {
  const codes = useStore((s) => s.codebook.statusCodes).filter((c) => c.kCode && !HIDDEN.has(c.kCode));
  const live = useStore((s) => s.settings.mode === "backend");
  const hasKey = useStore((s) => !!s.settings.apiKey);
  const [msg, setMsg] = useState("");
  const set = async (c: StatusCode) => {
    try {
      await setTruckStatus(applianceId, c.suffix);
      setMsg(`Set to ${c.kCode} ${c.label}.`);
      onDone?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const group = (title: string, list: StatusCode[]) => list.length > 0 && (
    <div className="kpick-group">
      <h4>{title}</h4>
      <div className="kpick-grid">
        {list.map((c) => (
          <button key={c.suffix} className={`kpick${current === c.kCode ? " on" : ""}`} style={{ ["--c" as string]: stateVar(c.state) }}
            aria-pressed={current === c.kCode} onClick={() => void set(c)}>
            <b>{c.kCode}</b><span>{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className={`kpick-wrap${big ? " big" : ""}`}>
      {group("Status", codes.filter((c) => !c.arrival))}
      {group("First to arrive", codes.filter((c) => c.arrival))}
      <p className="note">{msg || (live && hasKey ? "Sent to the live server, so everyone watching sees it."
        : live ? "Add the backend's editing key in Settings to share this; for now it's only on this screen."
        : "Only changes this screen, as if the truck had sent that K code.")}</p>
    </div>
  );
}
