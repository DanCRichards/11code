import { describe, expect, it } from "vitest";
import { synth } from "./selcall";
import { Decimator, StreamDecoder } from "./stream";

function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

describe("stream decoder", () => {
  it("decodes live audio fed in small blocks at 48 kHz, each call once", () => {
    const rand = seeded(5);
    const fs = 48000, secs = 14;
    const x = new Float32Array(fs * secs).map(() => (rand() - 0.5) * 0.02);
    const script: [number, string][] = [[1, "182821"], [3.3, "D8611-F1A0C2"], [6.1, "C072D2"], [9.7, "182260"], [12.4, "D72F1B"]];
    for (const [t, code] of script) {
      const b = synth(code, fs, 25, rand);
      x.set(b.subarray(0, Math.min(b.length, x.length - Math.round(t * fs))), Math.round(t * fs));
    }
    const dec = new Decimator(6); // 48 kHz -> 8 kHz, as the input source does
    const sd = new StreamDecoder(fs / 6);
    const got: [number, string][] = [];
    for (let i = 0; i < x.length; i += 128) { // audio-worklet-sized blocks
      for (const ev of sd.feed(dec.process(x.subarray(i, i + 128)))) {
        if (ev.confidence >= 0.5) got.push([ev.start, ev.code]);
      }
    }
    expect(got.map((g) => g[1])).toEqual(script.map((s) => s[1]));
    got.forEach(([t], i) => expect(Math.abs(t - (script[i][0] + 0.15))).toBeLessThan(0.05));
  });
});
