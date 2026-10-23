// SelCall encoder + decoder, compiled to WebAssembly (npm run wasm).
// Goertzel 15 ms / 2.5 ms hop, 3-frame vote, slot reader incl. the long
// appliance layout. src/decoder/selcall.ts is the JavaScript side: it copies
// audio in, calls these exports and unpacks the results.
//
// Results come back through one Float64Array (see `decode`); text (codes)
// travels as character codes so nothing here needs a string ABI.

// ---- tones ---------------------------------------------------------------

// Index order is the label order the rest of the app stores: 0-9, then A-F.
const NAMES = "0123456789ABCDEF";
const FREQS: StaticArray<f64> = [1981, 1124, 1197, 1275, 1358, 1446, 1540, 1640, 1747, 1860, 2400, 930, 2247, 991, 2110, 1055];
const E_INDEX: i32 = 14;

export function toneChar(i: i32): i32 { return NAMES.charCodeAt(i); }
export function toneHz(i: i32): f64 { return FREQS[i]; }

function toneIndex(c: i32): i32 {
  for (let i = 0; i < 16; i++) if (NAMES.charCodeAt(i) == c) return i;
  return -1;
}

// ---- settings ------------------------------------------------------------

const WIN_MS: f64 = 15, HOP_MS: f64 = 2.5, MIN_PURITY: f64 = 0.45, MIN_RATIO_DB: f64 = 2, FLOOR_DB: f64 = 40;
const SMOOTH: i32 = 3, MIN_TONE_MS: f64 = 8, BRIDGE_MS: f64 = 6, BURST_GAP_MS: f64 = 70, MIN_TONES: i32 = 4;
const TONE_MS: f64 = 20, FINAL_OFFSET_MS: f64 = 137, FINAL_MS: f64 = 35, SEARCH: f64 = 6;
const SEP_OFFSET_MS: f64 = 105, SEP_MS: f64 = 55, BODY_OFFSET_MS: f64 = 165, MAX_BODY: i32 = 7;

// ---- buffers shared with JavaScript ----------------------------------------

let input = new Float32Array(0);
let output = new Float64Array(0);
let outLen: i32 = 0;
let codeIn = new Int32Array(64);
let synthOut = new Float32Array(0);

/** Make room for `n` input samples and return where to write them. */
export function inputPtr(n: i32): usize {
  if (input.length < n) input = new Float32Array(n);
  return input.dataStart;
}
export function outputPtr(): usize { return output.dataStart; }
export function codePtr(): usize { return codeIn.dataStart; }
export function synthPtr(): usize { return synthOut.dataStart; }

function emit(v: f64): void {
  if (outLen >= output.length) {
    const grown = new Float64Array(max(64, output.length * 2));
    grown.set(output);
    output = grown;
  }
  output[outLen++] = v;
}

// ---- encoder -------------------------------------------------------------

let seed: f64 = 1;
function rand(): f64 {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}
function gauss(): f64 {
  let u: f64 = 0, v: f64 = 0;
  while (u == 0) u = rand();
  while (v == 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const spanTone = new Array<i32>(), spanStart = new Array<f64>(), spanDur = new Array<f64>();
function addSpan(t: i32, s: f64, d: f64): void { spanTone.push(t); spanStart.push(s); spanDur.push(d); }

/** Push tones at 20 ms spacing from `at`, sending a repeated tone as E. */
function addGroup(from: i32, to: i32, at: f64): void {
  let prev: i32 = -1;
  for (let k = from; k < to; k++) {
    const c = codeIn[k];
    addSpan(c == prev ? E_INDEX : toneIndex(c), at + <f64>(k - from) * 20, 20);
    prev = c;
  }
}

/**
 * Synthesise one call: the code's `len` characters are in codePtr(). White
 * noise at snrDb and, below 8 dB, FM-style clicks; `seedIn` drives the noise.
 * Returns the sample count; the samples are at synthPtr().
 */
export function synth(len: i32, fs: f64, snrDb: f64, seedIn: f64): i32 {
  seed = seedIn;
  spanTone.length = 0; spanStart.length = 0; spanDur.length = 0;
  let dash: i32 = -1;
  for (let i = 0; i < len; i++) if (codeIn[i] == 45) dash = i;
  if (dash >= 0) {
    addGroup(0, dash, 0);
    addSpan(toneIndex(codeIn[dash + 1]), 105, 55);
    addGroup(dash + 2, len, 165);
  } else {
    addGroup(0, min(5, len), 0);
    addSpan(toneIndex(codeIn[5]), 137, 45);
  }
  const last = spanTone.length - 1;
  const lead: f64 = 0.15, tail: f64 = 0.2;
  const n = <i32>Math.round((lead + (spanStart[last] + spanDur[last]) / 1000 + tail) * fs);
  if (synthOut.length < n) synthOut = new Float32Array(n);
  const x = synthOut;
  for (let i = 0; i < n; i++) x[i] = 0;
  const drift = (rand() - 0.5) * 12; // encoder tolerance, Hz
  let phase: f64 = 0;
  for (let p = 0; p <= last; p++) {
    const a = <i32>Math.round((lead + spanStart[p] / 1000) * fs);
    const b = <i32>Math.round((lead + (spanStart[p] + spanDur[p]) / 1000) * fs);
    const w = (2 * Math.PI * (FREQS[spanTone[p]] + drift)) / fs;
    for (let i = a; i < b; i++) { x[i] = <f32>(0.6 * Math.sin(phase)); phase += w; }
  }
  const sigma = Math.sqrt((0.6 * 0.6) / 2 / Math.pow(10, snrDb / 10));
  for (let i = 0; i < n; i++) x[i] = <f32>(<f64>x[i] + sigma * gauss());
  if (snrDb < 8) {
    const clicks = <i32>Math.round((8 - snrDb) * 2);
    for (let c = 0; c < clicks; c++) {
      const at = <i32>Math.floor(rand() * <f64>(n - 40)), amp = (rand() - 0.5) * 3;
      for (let i = 0; i < 24; i++) x[at + i] = <f32>(<f64>x[at + i] + amp * Math.sin((Math.PI * <f64>i) / 24));
    }
  }
  return n;
}

// ---- decoder: filter and detect ------------------------------------------

function biquad(x: Float32Array, b0: f64, b1: f64, b2: f64, a1: f64, a2: f64): void {
  let x1: f64 = 0, x2: f64 = 0, y1: f64 = 0, y2: f64 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = <f64>unchecked(x[i]);
    const v = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = v; // feedback stays full precision; the stored sample is float32
    unchecked(x[i] = <f32>v);
  }
}

function section(x: Float32Array, f: f64, high: bool, fs: f64): void {
  const w = (2 * Math.PI * f) / fs, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
  const g = high ? (1 + c) / 2 : (1 - c) / 2;
  biquad(x, g / a0, (high ? -(1 + c) : 1 - c) / a0, g / a0, (-2 * c) / a0, (1 - al) / a0);
}

/** Zero-phase band-pass, 850-2500 Hz (forward then backward), into a new array. */
function bandpass(src: Float32Array, n: i32, fs: f64): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = src[i];
  section(y, 850, true, fs); section(y, 2500, false, fs);
  y.reverse();
  section(y, 850, true, fs); section(y, 2500, false, fs);
  y.reverse();
  return y;
}

let times = new Float64Array(0);
let labels = new Int8Array(0);

function detect(y: Float32Array, fs: f64): void {
  const n = <i32>Math.round((WIN_MS * fs) / 1000), hop = <i32>Math.round((HOP_MS * fs) / 1000);
  const w = new Float32Array(n);
  let sw: f64 = 0, sw2: f64 = 0;
  for (let i = 0; i < n; i++) {
    w[i] = <f32>(0.5 - 0.5 * Math.cos((2 * Math.PI * <f64>i) / <f64>n));
    sw += <f64>w[i]; sw2 += <f64>w[i] * <f64>w[i];
  }
  const cs = new Array<Float32Array>(16), ss = new Array<Float32Array>(16);
  for (let k = 0; k < 16; k++) {
    const c = new Float32Array(n), s = new Float32Array(n);
    const f = FREQS[k];
    for (let i = 0; i < n; i++) {
      c[i] = <f32>(Math.cos((2 * Math.PI * f * <f64>i) / fs) * <f64>w[i]);
      s[i] = <f32>(Math.sin((2 * Math.PI * f * <f64>i) / fs) * <f64>w[i]);
    }
    cs[k] = c; ss[k] = s;
  }
  const frames = y.length < n ? 0 : (y.length - n) / hop + 1;
  const best = new Int8Array(frames), energy = new Float32Array(frames);
  const purity = new Float32Array(frames), ratio = new Float32Array(frames);
  // Hot loop: raw pointers so each step is a plain load (same arithmetic, same order).
  const wp = w.dataStart, yp = y.dataStart;
  const cps = new StaticArray<usize>(16), sps = new StaticArray<usize>(16);
  for (let k = 0; k < 16; k++) { cps[k] = cs[k].dataStart; sps[k] = ss[k].dataStart; }
  const bytes = <usize>n << 2;
  const pw = new StaticArray<f64>(16);
  for (let f = 0; f < frames; f++) {
    const yo = yp + (<usize>(f * hop) << 2);
    let e: f64 = 0;
    for (let i: usize = 0; i < bytes; i += 4) { const v = <f64>load<f32>(yo + i) * <f64>load<f32>(wp + i); e += v * v; }
    // Four tones per pass so each sample is loaded once; each tone's sums run in the same order.
    for (let k = 0; k < 16; k += 4) {
      const c0 = unchecked(cps[k]), c1 = unchecked(cps[k + 1]), c2 = unchecked(cps[k + 2]), c3 = unchecked(cps[k + 3]);
      const s0 = unchecked(sps[k]), s1 = unchecked(sps[k + 1]), s2 = unchecked(sps[k + 2]), s3 = unchecked(sps[k + 3]);
      let r0: f64 = 0, r1: f64 = 0, r2: f64 = 0, r3: f64 = 0, i0: f64 = 0, i1: f64 = 0, i2: f64 = 0, i3: f64 = 0;
      for (let i: usize = 0; i < bytes; i += 4) {
        const yi = <f64>load<f32>(yo + i);
        r0 += yi * <f64>load<f32>(c0 + i); i0 += yi * <f64>load<f32>(s0 + i);
        r1 += yi * <f64>load<f32>(c1 + i); i1 += yi * <f64>load<f32>(s1 + i);
        r2 += yi * <f64>load<f32>(c2 + i); i2 += yi * <f64>load<f32>(s2 + i);
        r3 += yi * <f64>load<f32>(c3 + i); i3 += yi * <f64>load<f32>(s3 + i);
      }
      unchecked(pw[k] = r0 * r0 + i0 * i0); unchecked(pw[k + 1] = r1 * r1 + i1 * i1);
      unchecked(pw[k + 2] = r2 * r2 + i2 * i2); unchecked(pw[k + 3] = r3 * r3 + i3 * i3);
    }
    let p1: f64 = 0, p2: f64 = 0, k1: i32 = 0;
    for (let k = 0; k < 16; k++) {
      const p = unchecked(pw[k]);
      if (p > p1) { p2 = p1; p1 = p; k1 = k; } else if (p > p2) p2 = p;
    }
    best[f] = <i8>k1; energy[f] = <f32>e;
    purity[f] = <f32>(((p1 / (e + 1e-12)) * 2 * sw2) / (sw * sw));
    ratio[f] = <f32>(10 * Math.log10(p1 / (p2 + 1e-12) + 1e-12));
  }
  const sorted = new Float32Array(frames);
  for (let f = 0; f < frames; f++) sorted[f] = energy[f];
  sorted.sort();
  const ref = (frames > 0 ? <f64>sorted[<i32>Math.floor(0.99 * <f64>(frames - 1))] : 0) + 1e-12;
  labels = new Int8Array(frames);
  times = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const ok = <f64>purity[f] > MIN_PURITY && <f64>ratio[f] > MIN_RATIO_DB &&
      10 * Math.log10(<f64>energy[f] / ref + 1e-12) > -FLOOR_DB;
    labels[f] = ok ? best[f] : -1;
    times[f] = (<f64>(f * hop) + <f64>n / 2) / fs;
  }
}

/** k-frame majority vote; ties keep the frame's own label, then the first seen. */
function majority(k: i32): void {
  const src = labels, out = new Int8Array(src.length), h = k >> 1;
  for (let i = 0; i < src.length; i++) {
    const lo = max(0, i - h), hi = min(src.length - 1, i + h);
    let bestL = src[i], bestV: i32 = 0;
    for (let j = lo; j <= hi; j++) if (src[j] == bestL) bestV++;
    for (let j = lo; j <= hi; j++) {
      const l = src[j];
      let v: i32 = 0;
      for (let q = lo; q <= hi; q++) if (src[q] == l) v++;
      if (v > bestV) { bestL = l; bestV = v; }
    }
    out[i] = bestL;
  }
  labels = out;
}

// ---- decoder: read slots -------------------------------------------------

const spanA = new Array<f64>(), spanB = new Array<f64>();
const pickLab = new Array<i32>(), pickCov = new Array<f64>();
const tryLab = new Array<i32>(), tryCov = new Array<f64>();
const counts = new StaticArray<i32>(16), order = new StaticArray<i32>(16);

/** Best label and its coverage for each span, sliding the grid ±SEARCH ms. */
function readSpans(start: f64): void {
  let bestScore: f64 = -1;
  pickLab.length = 0; pickCov.length = 0;
  for (let d = -SEARCH; d <= SEARCH + 0.01; d += 1) {
    tryLab.length = 0; tryCov.length = 0;
    let score: f64 = 0;
    for (let s = 0; s < spanA.length; s++) {
      const lo = start + (spanA[s] + d) / 1000, hi = start + (spanB[s] + d) / 1000;
      for (let k = 0; k < 16; k++) counts[k] = 0;
      let seen: i32 = 0, total: i32 = 0;
      const tm = times, lb = labels;
      for (let i = 0; i < tm.length; i++) {
        const t = unchecked(tm[i]);
        if (t >= lo && t <= hi) {
          total++;
          const l = <i32>unchecked(lb[i]);
          if (l >= 0) { if (unchecked(counts[l]) == 0) unchecked(order[seen++] = l); unchecked(counts[l]++); }
        }
      }
      let lab: i32 = -1, c: i32 = 0;
      for (let q = 0; q < seen; q++) { const l = order[q]; if (counts[l] > c) { lab = l; c = counts[l]; } }
      const cov: f64 = total ? <f64>c / <f64>total : 0;
      tryLab.push(lab); tryCov.push(cov);
      score += cov;
    }
    if (score > bestScore) {
      bestScore = score;
      pickLab.length = 0; pickCov.length = 0;
      for (let s = 0; s < tryLab.length; s++) { pickLab.push(tryLab[s]); pickCov.push(tryCov[s]); }
    }
  }
}

function headerSpans(): void {
  spanA.length = 0; spanB.length = 0;
  for (let k = 0; k < 5; k++) { spanA.push(<f64>k * TONE_MS + 3); spanB.push(<f64>(k + 1) * TONE_MS - 3); }
}

/** A group can't start with the repeat tone or send one tone twice in a row. */
function validGroup(lab: Array<i32>, from: i32, to: i32): bool {
  if (to > from && lab[from] == E_INDEX) return false;
  for (let i = from + 1; i < to; i++) if (lab[i] >= 0 && lab[i] == lab[i - 1]) return false;
  return true;
}

const code = new Array<i32>();
/** Append a group's tones as characters; E repeats the previous tone. */
function appendCode(lab: Array<i32>, from: i32, to: i32): void {
  let prev: i32 = 0;
  for (let i = from; i < to; i++) {
    let t: i32 = lab[i] >= 0 ? NAMES.charCodeAt(lab[i]) : 63; // "?"
    if (lab[i] == E_INDEX && prev != 0) t = prev;
    code.push(t);
    prev = t;
  }
}

const KIND_STATION: f64 = 0, KIND_APPLIANCE: f64 = 1, KIND_MSG: f64 = 2, KIND_UNKNOWN: f64 = 3;

/** Read one call starting at `start` and emit it: start, kind, confidence, code, slots. */
function slotRead(start: f64): void {
  headerSpans();
  spanA.push(SEP_OFFSET_MS + 3); spanB.push(min(SEP_OFFSET_MS + SEP_MS, FINAL_OFFSET_MS) - 3);
  for (let k = 0; k < MAX_BODY; k++) {
    spanA.push(BODY_OFFSET_MS + <f64>k * TONE_MS + 3); spanB.push(BODY_OFFSET_MS + <f64>(k + 1) * TONE_MS - 3);
  }
  readSpans(start);
  // Echo tails repeat the previous tone (real repeats are sent as E); past 5
  // body tones, need a clearer tone.
  let nb: i32 = 0;
  while (nb < MAX_BODY && pickCov[6 + nb] >= (nb < 5 ? 0.4 : 0.7) &&
         (nb == 0 || pickLab[6 + nb] != pickLab[5 + nb])) nb++;
  code.length = 0;
  if (pickCov[5] >= 0.6 && nb >= 3) {
    let conf: f64 = 2;
    for (let i = 0; i < 6; i++) conf = min(conf, pickCov[i]);
    for (let i = 0; i < 5; i++) conf = min(conf, pickCov[6 + i]);
    if (!(validGroup(pickLab, 0, 5) && validGroup(pickLab, 6, 6 + nb))) conf = 0;
    appendCode(pickLab, 0, 5);
    code.push(45); // "-"
    code.push(NAMES.charCodeAt(pickLab[5]));
    appendCode(pickLab, 6, 6 + nb);
    emitEvent(start, KIND_MSG, conf, 6 + nb);
    return;
  }
  headerSpans();
  spanA.push(FINAL_OFFSET_MS + 3); spanB.push(FINAL_OFFSET_MS + FINAL_MS - 3);
  readSpans(start);
  appendCode(pickLab, 0, 6);
  const c0 = code[0];
  const kind = c0 == 49 ? KIND_STATION : c0 == 67 || c0 == 68 ? KIND_APPLIANCE : KIND_UNKNOWN; // "1", "C", "D"
  let conf: f64 = 2;
  for (let i = 0; i < 6; i++) conf = min(conf, pickCov[i]);
  if (!validGroup(pickLab, 0, 5)) conf = 0;
  emitEvent(start, kind, conf, 6);
}

function emitEvent(start: f64, kind: f64, conf: f64, nSlots: i32): void {
  emit(start); emit(kind); emit(conf);
  emit(<f64>code.length);
  for (let i = 0; i < code.length; i++) emit(<f64>code[i]);
  emit(<f64>nSlots);
  for (let i = 0; i < nSlots; i++) { emit(<f64>pickLab[i]); emit(pickCov[i]); }
}

// ---- decoder: group tones into calls ---------------------------------------

const runL = new Array<i32>(), runS = new Array<i32>(), runE = new Array<i32>();

/**
 * Decode the `n` samples at inputPtr(). Writes, at outputPtr(), the number of
 * calls then for each: start (s), kind, confidence, code length, code
 * characters, slot count, then (label, coverage) per slot. Returns the length.
 */
export function decode(n: i32, fs: f64): i32 {
  outLen = 0;
  emit(0);
  detect(bandpass(input, n, fs), fs);
  const hop = times.length > 1 ? times[1] - times[0] : 1;
  majority(SMOOTH);
  const L = labels.length;
  // runs of one label
  runL.length = 0; runS.length = 0; runE.length = 0;
  let s: i32 = 0;
  for (let i = 1; i <= L; i++) {
    if (i == L || labels[i] != labels[s]) { runL.push(<i32>labels[s]); runS.push(s); runE.push(i); s = i; }
  }
  for (let r = 0; r < runL.length; r++) {
    if (runL[r] >= 0 && <f64>(runE[r] - runS[r]) * hop * 1000 < MIN_TONE_MS) runL[r] = -1;
  }
  // merge neighbours with the same label, then bridge short gaps inside a tone
  const mL = new Array<i32>(), mS = new Array<i32>(), mE = new Array<i32>();
  for (let r = 0; r < runL.length; r++) {
    const m = mL.length;
    if (m > 0 && mL[m - 1] == runL[r]) mE[m - 1] = runE[r];
    else { mL.push(runL[r]); mS.push(runS[r]); mE.push(runE[r]); }
  }
  const oL = new Array<i32>(), oS = new Array<i32>(), oE = new Array<i32>();
  for (let r = 0; r < mL.length; r++) {
    const o = oL.length;
    if (o >= 2 && mL[r] >= 0 && oL[o - 1] == -1 && oL[o - 2] == mL[r] &&
        <f64>(oE[o - 1] - oS[o - 1]) * hop * 1000 < BRIDGE_MS) {
      oL.pop(); oS.pop(); oE.pop();
      oE[o - 2] = mE[r];
    } else { oL.push(mL[r]); oS.push(mS[r]); oE.push(mE[r]); }
  }
  oL.push(-1); oS.push(L); oE.push(L + 1000000000);
  // bursts of tones separated by long silences are calls
  let count: i32 = 0, curLen: i32 = 0, curStart: i32 = 0;
  for (let r = 0; r < oL.length; r++) {
    if (oL[r] < 0) {
      if (<f64>(oE[r] - oS[r]) * hop * 1000 >= BURST_GAP_MS && curLen > 0) {
        if (curLen >= MIN_TONES) { slotRead(times[curStart]); count++; }
        curLen = 0;
      }
    } else {
      if (curLen == 0) curStart = oS[r];
      curLen++;
    }
  }
  output[0] = <f64>count;
  return outLen;
}
