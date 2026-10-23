import { decodeLong, synth } from "../decoder/selcall";
import type { Call } from "../core/types";
import { store, type FileCall, type Player } from "../store";

const DECODE_RATE = 8000;
const ENVELOPE_BINS = 600;
let seq = 0;

/**
 * Imported recordings: decode the whole file in the browser, then play it
 * through Web Audio and reveal each call on the board as playback reaches it.
 * Web Audio (not an <audio> element) so it also works where media URLs are
 * blocked, and so position and seeking are exact.
 */
export class FileSource {
  private ctx?: AudioContext;
  private buffer?: AudioBuffer;
  private node?: AudioBufferSourceNode;
  private startedAt = 0; // ctx time when playback last started
  private offset = 0; // file position when playback last started / paused
  private shown = 0; // how many found calls are on the board
  private timer?: number;
  private loadId = 0;
  private out?: GainNode;
  private offStore?: () => void;

  start() {
    store.set({ connection: { status: "file" }, calls: [], lastCall: undefined });
    let was = store.audible();
    this.offStore = store.subscribe(() => {
      const a = store.audible();
      if (a !== was) { was = a; this.applyMute(); }
    });
  }

  private applyMute() {
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(store.audible() ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  stop() {
    this.offStore?.();
    this.halt();
    clearInterval(this.timer);
    this.loadId++;
    store.set({ player: undefined });
  }

  private audio(): AudioContext {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private patch(p: Partial<Player>) {
    const cur = store.get().player;
    if (cur) store.set({ player: { ...cur, ...p } });
  }

  /** Load an audio or video file the user picked. */
  async load(file: File) {
    const ctx = this.audio(); // inside the tap/drop handler, so audio is allowed
    await this.begin(file.name, async () => ctx.decodeAudioData(await file.arrayBuffer()));
  }

  /** A generated minute of radio with a mix of calls, for trying the player. */
  async loadSample() {
    const ctx = this.audio();
    await this.begin("Sample recording (generated)", async () => {
      const fs = ctx.sampleRate, secs = 60;
      const x = new Float32Array(fs * secs);
      let r = 7;
      const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < x.length; i++) x[i] = (rand() - 0.5) * 0.03;
      const script: [number, string][] = [
        [2, "182261"], [6.5, "182260"], [11, "D72F1-F1A0C2"], [17, "182821"], [21, "182205"],
        [25, "D8611-F1A0C2"], [29, "D95D1-F1A0C2"], [34, "C072D2"], [38, "D72F1-F2A0C2"],
        [43, "D72F1B"], [48, "D8611-F2A0C2"], [53, "D95D1-F2A0C2"], [57, "182850"],
      ];
      for (const [t, code] of script) {
        const b = synth(code, fs, 14, rand);
        x.set(b.subarray(0, Math.min(b.length, x.length - Math.round(t * fs))), Math.round(t * fs));
      }
      const buf = ctx.createBuffer(1, x.length, fs);
      buf.getChannelData(0).set(x);
      return buf;
    });
  }

  private async begin(name: string, getBuffer: () => Promise<AudioBuffer>) {
    this.halt();
    const id = ++this.loadId;
    const reveal = store.get().player?.reveal ?? "play";
    store.set({
      calls: [], lastCall: undefined,
      player: { name, duration: 0, position: 0, playing: false, decoding: 0, found: [], envelope: [], reveal },
    });
    try {
      const buffer = await getBuffer();
      if (id !== this.loadId) return;
      this.buffer = buffer;
      this.offset = 0;
      this.shown = 0;
      const mono = await toDecodeRate(buffer);
      const events = await decodeLong(mono.x, mono.fs, (p) => { if (id === this.loadId) this.patch({ decoding: p }); });
      if (id !== this.loadId) return;
      const found: FileCall[] = events.map((ev) => ({
        offset: ev.start,
        call: { id: `f${(seq++).toString(36)}`, time: 0, code: ev.code, kind: ev.kind, confidence: ev.confidence, source: "file", slots: ev.slots },
      }));
      this.patch({ duration: buffer.duration, decoding: null, found, envelope: envelope(mono.x) });
      this.sync(true);
      this.tickLoop();
    } catch (e) {
      if (id !== this.loadId) return;
      this.patch({
        decoding: null,
        error: `Couldn't read that file as audio (${e instanceof Error ? e.message : String(e)}). WAV, MP3, M4A and most phone videos work; some browsers can't open every video format.`,
      });
    }
  }

  private position(): number {
    const p = store.get().player;
    if (!p) return 0;
    if (!p.playing || !this.ctx) return this.offset;
    return Math.min(p.duration, this.offset + (this.ctx.currentTime - this.startedAt));
  }

  play() {
    const p = store.get().player;
    if (!this.buffer || !p || p.decoding !== null) return;
    const ctx = this.audio();
    if (this.offset >= p.duration - 0.05) { this.offset = 0; this.sync(true); }
    const node = ctx.createBufferSource();
    node.buffer = this.buffer;
    if (!this.out) { this.out = ctx.createGain(); this.out.connect(ctx.destination); }
    this.applyMute();
    node.connect(this.out);
    node.onended = () => {
      if (this.node !== node) return;
      this.offset = this.position();
      this.node = undefined;
      this.patch({ playing: false, position: this.offset });
      this.sync(false);
    };
    node.start(0, this.offset);
    this.node = node;
    this.startedAt = ctx.currentTime;
    this.patch({ playing: true });
  }

  pause() {
    this.offset = this.position();
    this.halt();
    this.patch({ playing: false, position: this.offset });
  }

  toggle() {
    if (store.get().player?.playing) this.pause(); else this.play();
  }

  seek(t: number) {
    const p = store.get().player;
    if (!p) return;
    const was = p.playing;
    this.halt();
    this.offset = Math.max(0, Math.min(p.duration, t));
    this.patch({ playing: false, position: this.offset });
    this.sync(true);
    if (was) this.play();
  }

  setReveal(reveal: Player["reveal"]) {
    this.patch({ reveal });
    this.sync(true);
  }

  private halt() {
    const n = this.node;
    this.node = undefined;
    if (n) { try { n.stop(); } catch { /* already stopped */ } }
  }

  private tickLoop() {
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      const p = store.get().player;
      if (!p || !p.playing) return;
      this.patch({ position: this.position() });
      this.sync(false);
    }, 100);
  }

  /** Put the calls the listener has reached on the board, timed as if live. */
  private sync(reset: boolean) {
    const p = store.get().player;
    if (!p) return;
    const pos = p.reveal === "all" ? p.duration : this.position();
    const due = p.found.filter((f) => f.offset <= pos + 0.05);
    const stamp = (f: FileCall): Call => ({ ...f.call, time: Math.round(Date.now() - (pos - f.offset) * 1000) });
    if (reset) {
      store.replaceCalls(due.map(stamp));
      this.shown = due.length;
    } else if (due.length > this.shown) {
      store.addCalls(due.slice(this.shown).map(stamp));
      this.shown = due.length;
    }
  }
}

/** Mono at 8 kHz for the decoder (resampled by the browser), or the native rate as a fallback. */
async function toDecodeRate(buf: AudioBuffer): Promise<{ x: Float32Array; fs: number }> {
  try {
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * DECODE_RATE), DECODE_RATE);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination); // mixes channels down to mono
    src.start();
    return { x: (await off.startRendering()).getChannelData(0), fs: DECODE_RATE };
  } catch {
    const x = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < x.length; i++) x[i] += ch[i] / buf.numberOfChannels;
    }
    return { x, fs: buf.sampleRate };
  }
}

function envelope(x: Float32Array): number[] {
  const bins = Math.min(ENVELOPE_BINS, x.length);
  const per = Math.floor(x.length / bins);
  const out: number[] = [];
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = b * per; i < (b + 1) * per; i += 4) m = Math.max(m, Math.abs(x[i]));
    out.push(m);
  }
  const peak = Math.max(...out, 1e-6);
  return out.map((v) => Math.sqrt(v / peak));
}
