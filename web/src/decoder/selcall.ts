// SelCall encoder + decoder. The signal processing (filter, tone detection,
// slot reading, the tone table and timings) is WebAssembly built from
// assembly/selcall.ts; this file moves audio in and results out, and splits
// long recordings into chunks.
import wasmBase64 from "./wasm.gen";

interface Wasm {
  memory: WebAssembly.Memory;
  toneChar(i: number): number;
  toneHz(i: number): number;
  inputPtr(n: number): number;
  outputPtr(): number;
  codePtr(): number;
  synthPtr(): number;
  synth(len: number, fs: number, snrDb: number, seed: number): number;
  decode(n: number, fs: number): number;
}

function load(): Wasm {
  const bytes = Uint8Array.from(atob(wasmBase64), (c) => c.charCodeAt(0));
  const env = { abort: () => { throw new Error("SelCall decoder failed"); } };
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { env }).exports as unknown as Wasm;
}
const wasm = load();

/** Tone names by label index (0-9, A-F) and their frequencies, for the tone readout. */
export const NAMES = Array.from({ length: 16 }, (_, i) => String.fromCharCode(wasm.toneChar(i)));
export const TONES: Record<string, number> = Object.fromEntries(NAMES.map((n, i) => [n, wasm.toneHz(i)]));

export type Slot = [label: number, coverage: number];
export type CallKind = "station" | "appliance" | "appliance-msg" | "unknown";
export interface Decoded {
  start: number; // seconds into the buffer
  code: string;
  kind: CallKind;
  confidence: number;
  slots: Slot[];
}

const KINDS: CallKind[] = ["station", "appliance", "appliance-msg", "unknown"];

/** One call as audio with lead-in/out, white noise at snrDb and, below 8 dB, FM-style clicks. */
export function synth(code: string, fs: number, snrDb: number, rand: () => number = Math.random): Float32Array {
  if (code.length > 64) throw new Error("Code too long");
  const at = wasm.codePtr();
  const chars = new Int32Array(wasm.memory.buffer, at, code.length);
  for (let i = 0; i < code.length; i++) chars[i] = code.charCodeAt(i);
  const n = wasm.synth(code.length, fs, snrDb, 1 + Math.floor(rand() * 2147483646));
  const out = wasm.synthPtr();
  return new Float32Array(wasm.memory.buffer, out, n).slice();
}

/** Every call in a buffer of audio. */
export function decode(x: Float32Array, fs: number): Decoded[] {
  const at = wasm.inputPtr(x.length); // may grow memory, so take the buffer after it
  new Float32Array(wasm.memory.buffer, at, x.length).set(x);
  const len = wasm.decode(x.length, fs);
  const out = wasm.outputPtr();
  const r = new Float64Array(wasm.memory.buffer, out, len).slice();
  const events: Decoded[] = [];
  let p = 1;
  for (let e = 0; e < r[0]; e++) {
    const start = r[p++], kind = KINDS[r[p++]], confidence = r[p++];
    const codeLen = r[p++];
    const code = String.fromCharCode(...r.subarray(p, p + codeLen));
    p += codeLen;
    const slots: Slot[] = [];
    for (let s = 0, ns = r[p++]; s < ns; s++, p += 2) slots.push([r[p], r[p + 1]]);
    events.push({ start, code, kind, confidence, slots });
  }
  return events;
}

/**
 * Decode a long recording in overlapping chunks, yielding between chunks so
 * the page stays responsive. Mirrors selcall/stream.py: a call is taken from
 * the first chunk that holds all of it, and duplicates from the overlap are
 * dropped.
 */
export async function decodeLong(x: Float32Array, fs: number, onProgress?: (p: number) => void): Promise<Decoded[]> {
  const chunk = 20 * fs, hop = 18 * fs;
  const out: Decoded[] = [];
  for (let a = 0; a < x.length; a += hop) {
    const last = a + chunk >= x.length;
    const t0 = a / fs, end = Math.min(x.length, a + chunk) / fs;
    for (const ev of decode(x.subarray(a, a + chunk), fs)) {
      const start = ev.start + t0;
      if (a > 0 && ev.start < 0.4) continue; // front cut off; the previous chunk had it whole
      if (!last && start > end - 0.6) continue; // may run past this chunk; the next one has it
      if (out.some((o) => Math.abs(o.start - start) < 0.15)) continue;
      out.push({ ...ev, start });
    }
    onProgress?.(Math.min(1, (a + chunk) / x.length));
    if (last) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  return out.sort((p, q) => p.start - q.start);
}
