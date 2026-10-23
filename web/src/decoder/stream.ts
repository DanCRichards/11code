import { decode, type Decoded } from "./selcall";

/**
 * Decode continuous audio (a microphone or line-in) in chunks: keep the last
 * few seconds, re-decode every `hop`, and report each call once it's safely
 * complete. A port of selcall/stream.py.
 */
export class StreamDecoder {
  private buf: Float32Array;
  private len = 0;
  private bufStart = 0; // stream time of buf[0], seconds
  private pending = 0;
  private emitted: number[] = [];
  private readonly window: number;
  private readonly hop: number;

  constructor(readonly fs: number, windowS = 2.5, hopS = 0.5, private readonly settle = 0.6) {
    this.window = Math.round(windowS * fs);
    this.hop = Math.round(hopS * fs);
    this.buf = new Float32Array(this.window + this.hop * 4);
  }

  /** Stream time (seconds) at the end of the audio received so far. */
  get now(): number {
    return this.bufStart + this.len / this.fs;
  }

  /** Add samples; returns calls that just completed, with stream-time starts. */
  feed(samples: Float32Array): Decoded[] {
    const out: Decoded[] = [];
    let i = 0;
    while (i < samples.length) {
      const room = this.buf.length - this.len;
      const n = Math.min(room, samples.length - i);
      this.buf.set(samples.subarray(i, i + n), this.len);
      this.len += n;
      this.pending += n;
      i += n;
      while (this.pending >= this.hop) {
        this.pending -= this.hop;
        out.push(...this.decodeNow());
      }
      if (this.len === this.buf.length) this.trim();
    }
    return out;
  }

  private decodeNow(): Decoded[] {
    const end = this.now;
    const out: Decoded[] = [];
    for (const ev of decode(this.buf.subarray(0, this.len), this.fs)) {
      const start = ev.start + this.bufStart;
      if (start > end - this.settle) continue; // may still be arriving
      if (this.bufStart > 0 && ev.start < 0.4) continue; // front cut off; reported when whole
      if (this.emitted.some((t) => Math.abs(t - start) < 0.15)) continue;
      this.emitted.push(start);
      out.push({ ...ev, start });
    }
    this.trim();
    this.emitted = this.emitted.filter((t) => t > this.bufStart - 1);
    return out;
  }

  private trim() {
    if (this.len <= this.window) return;
    const drop = this.len - this.window;
    this.buf.copyWithin(0, drop, this.len);
    this.len = this.window;
    this.bufStart += drop / this.fs;
  }
}

/** Box-filter decimator: averages blocks of `factor` samples (enough for tones under 2.5 kHz). */
export class Decimator {
  private acc = 0;
  private count = 0;
  constructor(readonly factor: number) {}

  process(x: Float32Array): Float32Array {
    const out = new Float32Array(Math.floor((x.length + this.count) / this.factor));
    let o = 0;
    for (let i = 0; i < x.length; i++) {
      this.acc += x[i];
      if (++this.count === this.factor) {
        out[o++] = this.acc / this.factor;
        this.acc = 0;
        this.count = 0;
      }
    }
    return out.subarray(0, o);
  }
}
