import { decode, synth } from "../decoder/selcall";
import type { ApplianceState, Appliance, Call, Codebook } from "../core/types";
import { store } from "../store";

// Codes heard in real recordings that the codebook can't place yet; the demo
// sends a few so the "unknown codes" inbox has something real in it.
const REAL_UNKNOWNS = ["C072D2", "C09C02", "C72D1-F1400C", "C9C01-F1400C", "186661", "126212", "186412"];
const BUSY_STATIONS = new Set(["auckland-city", "grey-lynn", "parnell", "balmoral", "mt-roskill", "avondale", "henderson", "papatoetoe"]);
const DEFAULT_SUFFIX: Partial<Record<ApplianceState, string>> = {
  responding: "F1A0C2", "at-incident": "F2A0C2", "out-of-area": "F3A0C2", "available-radio": "F4A0C2", "on-station": "F7A0C2",
};

const U = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
let seq = 0;

interface Job { due: number; run: (wall: number) => void }

/**
 * Simulated radio traffic. Incidents play out in "sim seconds" with realistic
 * timings (minutes), sped up by settings.sim.speed. Every transmission is
 * synthesised as SelCall audio, noise is added, and the board receives only
 * what the decoder recovers.
 */
export class DemoSource {
  private simNow = 0;
  private lastReal = 0;
  private jobs: Job[] = [];
  private busy = new Set<string>();
  private nextIncident = 0;
  private timer?: number;
  private audio?: AudioContext;
  private seeding = false;

  start() {
    store.set({ connection: { status: "demo" } });
    this.seed();
    this.lastReal = performance.now();
    this.timer = window.setInterval(() => this.tick(), 200);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Fill the log with the last ~40 simulated minutes so the board opens busy. */
  private seed() {
    const speed = store.get().settings.sim.speed;
    const span = 40 * 60;
    const wallStart = Date.now() - (span / speed) * 1000;
    const calls: Call[] = [];
    this.seeding = true;
    this.nextIncident = 0;
    while (this.simNow < span) {
      this.simNow += 5;
      this.maybeIncident();
      this.runDue((due) => wallStart + (due / speed) * 1000, calls);
    }
    this.seeding = false;
    store.replaceCalls(calls);
  }

  private tick() {
    const now = performance.now();
    const { speed, auto } = store.get().settings.sim;
    this.simNow += ((now - this.lastReal) / 1000) * speed;
    this.lastReal = now;
    if (auto) this.maybeIncident();
    const out: Call[] = [];
    this.runDue((due) => Date.now() - ((this.simNow - due) / speed) * 1000, out);
    store.addCalls(out);
  }

  private runDue(wallOf: (due: number) => number, out: Call[]) {
    this.jobs.sort((a, b) => a.due - b.due);
    while (this.jobs.length && this.jobs[0].due <= this.simNow) {
      const job = this.jobs.shift()!;
      this.collect = out;
      job.run(wallOf(job.due));
    }
  }
  private collect: Call[] = [];

  private at(delay: number, run: (wall: number) => void) {
    this.jobs.push({ due: this.simNow + delay, run });
  }

  private maybeIncident() {
    if (this.simNow < this.nextIncident) return;
    this.nextIncident = this.simNow + U(80, 420);
    this.startIncident();
  }

  private get cb(): Codebook {
    return store.get().codebook;
  }

  /** Turn out one or two appliances from a station and play the job through. */
  /** Turn out a station; `whole` sends the whole-station call and turns out every free truck. */
  startIncident(stationId?: string, whole = false): boolean {
    const cb = this.cb;
    const free = (sid: string) => cb.appliances.filter((a) => a.stationId === sid && !this.busy.has(a.id) && a.selcallId);
    const candidates = cb.stations.filter((s) => free(s.id).length && cb.turnoutCodes.some((c) => c.stationId === s.id));
    if (!candidates.length || this.busy.size > 14) return false;
    const station = stationId ? cb.stations.find((s) => s.id === stationId) : pick(candidates.flatMap((s) => (BUSY_STATIONS.has(s.id) ? [s, s, s] : [s])));
    if (!station || !free(station.id).length) return false;
    const stationCode = cb.turnoutCodes.find((c) => c.stationId === station.id && !c.applianceId);
    if (whole && stationCode) {
      const apps = free(station.id);
      this.at(0, (w) => this.send(stationCode.code, w));
      apps.forEach((a, i) => { this.busy.add(a.id); this.playJob(a, U(30, 90) + i * 15); });
      return true;
    }
    const apps = free(station.id).slice(0, Math.random() < 0.3 ? 2 : 1);
    for (const [i, a] of apps.entries()) {
      this.busy.add(a.id);
      const own = cb.turnoutCodes.filter((c) => c.applianceId === a.id);
      const code = own.length && !(stationCode && Math.random() < 0.15) ? pick(own).code : stationCode?.code;
      if (code) this.at(i * U(5, 40), (w) => this.send(code, w));
      this.playJob(a, U(30, 90) + i * 20);
    }
    if (Math.random() < 0.08) this.at(U(20, 600), (w) => this.send(pick(REAL_UNKNOWNS), w));
    return true;
  }

  private playJob(a: Appliance, t: number) {
    const status = (state: ApplianceState) => {
      const suffix = this.cb.statusCodes.find((s) => s.state === state)?.suffix ?? DEFAULT_SUFFIX[state];
      return suffix ? `${a.selcallId}-${suffix}` : null;
    };
    const say = (delay: number, state: ApplianceState) => {
      const code = status(state);
      if (code) this.at(delay, (w) => this.send(code, w));
    };
    say(t, "responding");
    const scene = t + U(180, 540);
    say(scene, Math.random() < 0.06 ? "out-of-area" : "at-incident");
    if (Math.random() < 0.12) {
      const final = this.cb.callTypes.find((c) => c.priority)?.final ?? "B";
      this.at(scene + U(30, 240), (w) => this.send(`${a.selcallId}${final}`, w));
    }
    const avail = scene + U(600, 2400);
    say(avail, "available-radio");
    const home = avail + U(240, 900);
    say(home, "on-station");
    this.at(home + 1, () => this.busy.delete(a.id));
  }

  /** Send a priority call from a random appliance that's out. */
  priorityCall(): boolean {
    const a = this.cb.appliances.find((x) => this.busy.has(x.id)) ?? pick(this.cb.appliances.filter((x) => x.selcallId));
    if (!a) return false;
    const final = this.cb.callTypes.find((c) => c.priority)?.final ?? "B";
    store.addCalls([this.transmit(`${a.selcallId}${final}`, Date.now())]);
    return true;
  }

  turnoutNow(stationId?: string, whole = false) {
    const ok = this.startIncident(stationId, whole);
    this.tick();
    return ok;
  }

  private send(code: string, wall: number) {
    this.collect.push(this.transmit(code, wall));
  }

  private transmit(code: string, wall: number): Call {
    const { snr, sound } = store.get().settings.sim;
    const ctx = sound && !this.seeding ? this.ctx() : undefined;
    const fs = ctx ? ctx.sampleRate : 8000;
    const x = synth(code, fs, snr);
    const ev = decode(x, fs)[0];
    if (ctx) this.play(ctx, x, fs);
    return {
      id: `d${Date.now().toString(36)}${(seq++).toString(36)}`,
      time: Math.round(wall),
      code: ev?.code ?? "",
      kind: ev?.kind ?? "none",
      confidence: ev?.confidence ?? 0,
      source: "demo",
      slots: ev?.slots,
      sent: code,
    };
  }

  private ctx(): AudioContext | undefined {
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === "suspended") void this.audio.resume();
      return this.audio;
    } catch {
      return undefined;
    }
  }

  /** Called from a tap so browsers allow audio later. */
  unlockAudio() {
    this.ctx();
  }

  private play(ctx: AudioContext, x: Float32Array, fs: number) {
    const buf = ctx.createBuffer(1, x.length, fs);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < x.length; i++) ch[i] = x[i] * 0.3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  }
}
