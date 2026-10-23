import type { Codebook } from "../core/types";
import { validateCodebook } from "../core/validate";
import { BUNDLED, save, store } from "../store";
import { BackendSource } from "./backend";
import { DemoSource } from "./demo";

let demo: DemoSource | undefined;
let backend: BackendSource | undefined;

/** Start the source for the current mode, stopping the previous one. */
export function startSource() {
  demo?.stop();
  backend?.stop();
  demo = backend = undefined;
  const { mode, backendUrl } = store.get().settings;
  if (mode === "backend") {
    backend = new BackendSource(BackendSource.normalise(backendUrl));
    void backend.start();
  } else {
    const local = (() => { try { return JSON.parse(localStorage.getItem("tb.codebook.local") ?? "null"); } catch { return null; } })();
    store.set({ codebook: local ?? BUNDLED, codebookOrigin: local ? "local" : "bundled", calls: [] });
    demo = new DemoSource();
    demo.start();
  }
}

export const demoActions = {
  turnout: (stationId?: string) => demo?.turnoutNow(stationId) ?? false,
  priority: () => demo?.priorityCall() ?? false,
  unlockAudio: () => demo?.unlockAudio(),
};

/** Save an edited codebook: to the backend in live mode, else this browser. */
export async function saveCodebook(next: Codebook): Promise<void> {
  const problems = validateCodebook(next);
  if (problems.length) throw new Error(problems.slice(0, 4).join(" "));
  if (backend) {
    const key = store.get().settings.apiKey;
    if (!key) throw new Error("Add the backend's editing key under Data source first.");
    await backend.saveCodebook(next, key);
    return;
  }
  const cb = { ...next, version: next.version + 1, updatedAt: new Date().toISOString() };
  save("tb.codebook.local", cb);
  store.set({ codebook: cb, codebookOrigin: "local" });
}

export function resetLocalCodebook() {
  save("tb.codebook.local", undefined);
  store.set({ codebook: BUNDLED, codebookOrigin: "bundled" });
}

/** Probe for a backend at the page's own origin (when the server hosts the app). */
export async function detectSameOriginBackend(): Promise<boolean> {
  if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return false;
  if (/github\.io$/.test(location.hostname)) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch("./api/health", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}
