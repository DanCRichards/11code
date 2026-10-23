import { describe, expect, it } from "vitest";
import { decode, synth } from "./selcall";

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
