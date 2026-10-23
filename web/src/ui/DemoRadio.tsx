import { useState } from "react";
import { demoActions } from "../sources/controller";
import { store, useStore } from "../store";
import { Seg } from "./common";

export function DemoRadio() {
  const sim = useStore((s) => s.settings.sim);
  const [msg, setMsg] = useState("");
  return (
    <section className="panel radio" aria-label="Demo radio">
      <h2>Demo radio <small>simulated traffic, decoded from audio</small></h2>
      <div className="row">
        <button className="btn primary" onClick={() => { demoActions.unlockAudio(); setMsg(demoActions.turnout() ? "" : "Every station with a free appliance is busy."); }}>Turn out a station</button>
        <button className="btn" onClick={() => { demoActions.unlockAudio(); demoActions.priority(); }}>Send priority call</button>
        <button className="btn" aria-pressed={sim.auto} onClick={() => store.sim({ auto: !sim.auto })}>Auto traffic</button>
        <button className="btn" aria-pressed={sim.sound} onClick={() => { store.sim({ sound: !sim.sound }); demoActions.unlockAudio(); }}>Hear the tones</button>
      </div>
      {msg && <div className="small muted">{msg}</div>}
      <div className="row"><label>Speed</label>
        <Seg label="Demo speed" value={sim.speed} onChange={(v) => store.sim({ speed: v })} options={[[1, "1×"], [5, "5×"], [20, "20×"], [60, "60×"]]} /></div>
      <div className="row"><label>Signal</label>
        <Seg label="Signal strength" value={sim.snr} onChange={(v) => store.sim({ snr: v })} options={[[25, "Strong"], [8, "Fair"], [2, "Weak"], [-3, "Very weak"]]} /></div>
    </section>
  );
}
