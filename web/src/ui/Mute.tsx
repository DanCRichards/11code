import { useEffect, useState } from "react";
import { store, useStore } from "../store";

/** Header button: mute/un-mute radio audio; shows a countdown while an alert has un-muted it. */
export function MuteButton() {
  const muted = useStore((s) => s.settings.muted);
  const until = useStore((s) => s.unmutedUntil);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  const left = until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  const temp = muted && left > 0;
  const label = temp ? `Alert: sound on for ${left}s. Tap to mute now` : muted ? "Radio audio muted. Tap to un-mute" : "Radio audio on. Tap to mute";
  return (
    <button className={`gear mute${muted && !temp ? " off" : ""}${temp ? " temp" : ""}`} aria-label={label} title={label}
      onClick={() => {
        if (temp) store.set({ unmutedUntil: undefined });
        else store.settings({ muted: !muted });
      }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
        {muted && !temp ? <path d="m16 9 5 6M21 9l-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
      </svg>
      {temp && <span className="badge">{left}</span>}
    </button>
  );
}
