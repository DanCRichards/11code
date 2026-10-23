import type { Call, Codebook } from "../core/types";
import { store } from "../store";

/** Live mode: codebook + calls from the backend (server/), updates over SSE. */
export class BackendSource {
  private es?: EventSource;
  private stopped = false;
  constructor(private base: string) {}

  static normalise(url: string): string {
    return url.trim().replace(/\/+$/, "");
  }

  private url(path: string) {
    return this.base ? `${this.base}${path}` : `.${path}`;
  }

  async start() {
    store.set({ connection: { status: "connecting" } });
    try {
      await this.loadCodebook();
      const res = await fetch(this.url("/api/calls?limit=1000"));
      if (!res.ok) throw new Error(`calls: HTTP ${res.status}`);
      const body = (await res.json()) as { calls: RawCall[] };
      if (this.stopped) return;
      store.replaceCalls(body.calls.map(toCall));
    } catch (e) {
      if (!this.stopped) store.set({ connection: { status: "error", message: explain(e, this.base) } });
      return;
    }
    this.openStream();
  }

  stop() {
    this.stopped = true;
    this.es?.close();
  }

  private openStream() {
    const es = new EventSource(this.url("/api/stream"));
    this.es = es;
    es.onopen = () => store.set({ connection: { status: "live" } });
    es.onerror = () => {
      if (!this.stopped) store.set({ connection: { status: "reconnecting", message: "Lost the live feed; retrying." } });
    };
    es.addEventListener("call", (e) => {
      store.addCalls([toCall(JSON.parse((e as MessageEvent).data))]);
    });
    es.addEventListener("codebook", () => { void this.loadCodebook(); });
  }

  async loadCodebook() {
    const res = await fetch(this.url("/api/codebook"), { cache: "no-store" });
    if (!res.ok) throw new Error(`codebook: HTTP ${res.status}`);
    const cb = (await res.json()) as Codebook;
    if (!this.stopped) store.set({ codebook: cb, codebookOrigin: "backend" });
  }

  async saveCodebook(cb: Codebook, apiKey: string): Promise<Codebook> {
    const res = await fetch(this.url("/api/codebook"), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey, "If-Match": String(cb.version) },
      body: JSON.stringify(cb),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409) await this.loadCodebook();
      throw new Error(body.error ?? `Save failed (HTTP ${res.status})`);
    }
    store.set({ codebook: body as Codebook, codebookOrigin: "backend" });
    return body as Codebook;
  }

  /** Post a call (e.g. a status set by hand); it comes back to every viewer over the stream. */
  async postCall(code: string, source: string, apiKey: string) {
    const res = await fetch(this.url("/api/calls"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ code, kind: "appliance-msg", confidence: 1, source }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Couldn't send (HTTP ${res.status})`);
    }
  }
}

interface RawCall { id: string; time: string; code: string; kind: Call["kind"]; confidence: number; source: string }

function toCall(c: RawCall): Call {
  return { id: c.id, time: Date.parse(c.time), code: c.code, kind: c.kind, confidence: c.confidence, source: c.source };
}

function explain(e: unknown, base: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (typeof location !== "undefined" && location.protocol === "https:" && base.startsWith("http://") &&
      !/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) {
    return "This page is on https, so the browser blocks an http backend. Serve the backend over https, or open the board from the backend itself.";
  }
  return `Couldn't reach the backend (${msg}). Check the address and that the server is running.`;
}
