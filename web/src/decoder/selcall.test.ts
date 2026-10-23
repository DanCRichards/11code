import { describe, expect, it } from "vitest";
import { decode, decodeLong, synth } from "./selcall";

function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const CODES = ["182201", "182822", "C072D2", "C72D1-F1400C", "D95D1-F1A0C2", "CC4CF-F8AB7C", "182200"];

describe("selcall decoder", () => {
  it("decodes every call type on a clean signal", () => {
    const rand = seeded(1);
    for (const code of CODES) {
      const [ev] = decode(synth(code, 8000, 20, rand), 8000);
      expect(ev?.code).toBe(code);
      expect(ev.confidence).toBeGreaterThan(0.5);
    }
  });

  it("works at the audio context's rate too", () => {
    const [ev] = decode(synth("D95D1-F2A0C2", 48000, 20, seeded(2)), 48000);
    expect(ev.code).toBe("D95D1-F2A0C2");
  });

  it("never reports a wrong code with high confidence on a weak signal", () => {
    const rand = seeded(3);
    let wrongConfident = 0;
    for (let i = 0; i < 20; i++) {
      for (const code of CODES) {
        const ev = decode(synth(code, 8000, 2, rand), 8000)[0];
        if (ev && ev.confidence >= 0.5 && ev.code !== code) wrongConfident++;
      }
    }
    expect(wrongConfident).toBe(0);
  });

  it("finds nothing in noise", () => {
    const rand = seeded(4);
    const x = new Float32Array(8000 * 3).map(() => (rand() - 0.5) * 0.6);
    expect(decode(x, 8000).filter((e) => e.confidence >= 0.5)).toEqual([]);
  });
});

describe("long recordings", () => {
  it("finds every call across chunk boundaries exactly once", async () => {
    const rand = seeded(9);
    const fs = 8000, secs = 70;
    const x = new Float32Array(fs * secs).map(() => (rand() - 0.5) * 0.02);
    const placed: [number, string][] = [];
    // Put calls right on and around the 18 s chunk boundaries.
    [[2, "182821"], [17.7, "C72D1-F1400C"], [19.6, "182201"], [35.8, "D8611-F2A0C2"], [54.1, "182850"], [68, "C072D2"]]
      .forEach(([t, code]) => {
        const burst = synth(code as string, fs, 30, rand);
        x.set(burst.subarray(0, Math.min(burst.length, x.length - Math.round((t as number) * fs))), Math.round((t as number) * fs));
        placed.push([(t as number) + 0.15, code as string]);
      });
    const found = (await decodeLong(x, fs)).filter((e) => e.confidence >= 0.5);
    expect(found.map((e) => e.code)).toEqual(placed.map((p) => p[1]));
    found.forEach((e, i) => expect(Math.abs(e.start - placed[i][0])).toBeLessThan(0.05));
  });
});
