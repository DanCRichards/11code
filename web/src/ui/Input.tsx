import { useEffect, useRef, useState } from "react";
import { inputActions } from "../sources/controller";
import { useStore } from "../store";

/** Listen to a scanner via microphone, line-in or a USB sound card. */
export function InputPanel({ compact }: { compact?: boolean }) {
  const mode = useStore((s) => s.settings.mode);
  const st = useStore((s) => s.input);
  const cfg = useStore((s) => s.settings.input);
  const active = mode === "input";
  const listening = active && st?.status === "listening";
  const quiet = useQuietFor(listening ? st!.level : 1, 0.2, 4000);

  if (compact && !active) {
    return (
      <section className="panel" aria-label="Listen to a radio">
        <h2>Audio input</h2>
        <div className="row">
          <button className="btn primary" onClick={() => void inputActions.listen()}>Use an audio input</button>
        </div>
      </section>
    );
  }

  const deviceName = st?.devices.find((d) => d.id === cfg.deviceId)?.label ?? "Default input";
  const micLike = /mic|built-in|internal|default/i.test(deviceName);
  const levelPct = Math.round((st?.level ?? 0) * 100);
  const clipping = (st?.peak ?? 0) > 0.98;

  return (
    <section className="panel input" aria-label="Live input">
      <h2>
        <span className="row" style={{ gap: 8 }}>{listening && <i className="live-dot" />}{listening ? "Listening" : "Live input"}</span>
        <small>{listening ? `${st!.heard} call${st!.heard === 1 ? "" : "s"} decoded · ${Math.round((st!.rate ?? 0) / 1000)} kHz` : "microphone, line-in or USB sound card"}</small>
      </h2>

      <label className="field"><span>Input</span>
        <select value={cfg.deviceId} onChange={(e) => inputActions.setDevice(e.target.value)} aria-label="Audio input">
          <option value="">Default input</option>
          {st?.devices.filter((d) => d.id && d.id !== "default").map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select></label>

      <div className="row">
        {listening
          ? <button className="btn" onClick={() => inputActions.pause()}>Stop listening</button>
          : <button className="btn primary" disabled={st?.status === "starting"} onClick={() => void inputActions.listen()}>{st?.status === "starting" ? "Starting…" : "Start listening"}</button>}
        <button className="btn" onClick={() => inputActions.close()}>Back to demo</button>
      </div>
      {st?.error && <p className="error">{st.error}</p>}

      {listening && (
        <div className="grid-gap">
          <div className="row small" style={{ justifyContent: "space-between" }}>
            <span>Input level</span>
            <b className={clipping ? "error" : quiet ? "muted" : ""}>{clipping ? "Too loud: turn it down" : quiet ? "Very quiet: turn the scanner up" : `${levelPct}%`}</b>
          </div>
          <div className="levelmeter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelPct} aria-label="Input level">
            <i style={{ width: `${levelPct}%` }} />
            <b style={{ left: `${Math.min(100, Math.round((st!.peak ?? 0) * 100))}%` }} />
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <label className="check"><input type="checkbox" checked={cfg.monitor} onChange={(e) => inputActions.setMonitor({ monitor: e.target.checked })} /> Play the input through my speakers</label>
        <label className="row small" style={{ gap: 6 }}>Volume
          <input type="range" min={0} max={1} step={0.05} value={cfg.volume} disabled={!cfg.monitor}
            onChange={(e) => inputActions.setMonitor({ volume: Number(e.target.value) })} aria-label="Monitor volume" />
        </label>
      </div>
      {cfg.monitor && micLike && <p className="note">Use headphones with a microphone to avoid feedback.</p>}
      {!compact && !listening && (
        <p className="note">Connect the scanner's headphone out to line-in or a USB sound card.</p>
      )}
    </section>
  );
}

/** True when `value` has stayed under `limit` for `ms`. */
function useQuietFor(value: number, limit: number, ms: number) {
  const since = useRef<number | null>(null);
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    if (value >= limit) { since.current = null; setQuiet(false); return; }
    since.current ??= Date.now();
    setQuiet(Date.now() - since.current > ms);
  }, [value, limit, ms]);
  return quiet;
}
