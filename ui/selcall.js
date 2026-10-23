// SelCall encoder + decoder: a port of selcall/decode.py's default path
// (Goertzel 15 ms, 2.5 ms hop, 3-frame vote, slot reader with long-message layout).
(function (root) {
  const TONES = { "1": 1124, "2": 1197, "3": 1275, "4": 1358, "5": 1446, "6": 1540, "7": 1640,
    "8": 1747, "9": 1860, "0": 1981, A: 2400, B: 930, C: 2247, D: 991, E: 2110, F: 1055 };
  const NAMES = Object.keys(TONES);
  const FREQS = NAMES.map((n) => TONES[n]);
  const CFG = { fs: 8000, winMs: 15, hopMs: 2.5, minPurity: 0.45, minRatioDb: 2, floorDb: 40,
    smooth: 3, minToneMs: 8, bridgeMs: 6, burstGapMs: 70, minTones: 4, toneMs: 20,
    finalOffsetMs: 137, finalMs: 35, search: 6, sepOffsetMs: 105, sepMs: 55, bodyOffsetMs: 165,
    maxBody: 7 };

  // ---- encoder -------------------------------------------------------------
  function withRepeats(tones) {
    const out = []; let prev = null;
    for (const t of tones) { out.push(t === prev ? "E" : t); prev = t; }
    return out;
  }
  // Returns [{tone, startMs, durMs}] for a code: "182201" or "C72D1-F1400C".
  function schedule(code) {
    if (code.includes("-")) {
      const [head, rest] = code.split("-");
      return [
        ...withRepeats([...head]).map((t, k) => ({ tone: t, startMs: k * 20, durMs: 20 })),
        { tone: rest[0], startMs: 105, durMs: 55 },
        ...withRepeats([...rest.slice(1)]).map((t, k) => ({ tone: t, startMs: 165 + k * 20, durMs: 20 })),
      ];
    }
    return [
      ...withRepeats([...code.slice(0, 5)]).map((t, k) => ({ tone: t, startMs: k * 20, durMs: 20 })),
      { tone: code[5], startMs: 137, durMs: 45 },
    ];
  }
  function randn(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand(); while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Audio for one call with lead-in/out, white noise at snrDb and, when weak,
  // FM-style clicks. Returns Float32Array at fs.
  function synth(code, fs, snrDb, rand = Math.random) {
    const parts = schedule(code);
    const end = parts[parts.length - 1];
    const lead = 0.15, tail = 0.2;
    const n = Math.round((lead + (end.startMs + end.durMs) / 1000 + tail) * fs);
    const x = new Float32Array(n);
    const drift = (rand() - 0.5) * 12; // encoder tolerance, Hz
    let phase = 0;
    for (const p of parts) {
      const a = Math.round((lead + p.startMs / 1000) * fs);
      const b = Math.round((lead + (p.startMs + p.durMs) / 1000) * fs);
      const w = (2 * Math.PI * (TONES[p.tone] + drift)) / fs;
      for (let i = a; i < b; i++) { x[i] = 0.6 * Math.sin(phase); phase += w; }
    }
    const sigma = Math.sqrt((0.6 * 0.6) / 2 / Math.pow(10, snrDb / 10));
    for (let i = 0; i < n; i++) x[i] += sigma * randn(rand);
    if (snrDb < 8) {
      const clicks = Math.round((8 - snrDb) * 2);
      for (let c = 0; c < clicks; c++) {
        const at = Math.floor(rand() * (n - 40)), amp = (rand() - 0.5) * 3;
        for (let i = 0; i < 24; i++) x[at + i] += amp * Math.sin((Math.PI * i) / 24);
      }
    }
    return x;
  }

  // ---- decoder -------------------------------------------------------------
  function biquad(x, b0, b1, b2, a1, a2) {
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  // Zero-phase band-pass (forward then backward, like scipy's sosfiltfilt):
  // 2nd-order high-pass at 850 Hz and low-pass at 2500 Hz.
  function bandpass(x, fs) {
    const hp = (f) => { const w = 2 * Math.PI * f / fs, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
      return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0]; };
    const lp = (f) => { const w = 2 * Math.PI * f / fs, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
      return [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0]; };
    let y = x;
    for (const k of [hp(850), lp(2500)]) y = biquad(y, ...k);
    y.reverse();
    for (const k of [hp(850), lp(2500)]) y = biquad(y, ...k);
    return y.reverse();
  }
  function detect(y, fs) {
    const n = Math.round(CFG.winMs * fs / 1000), hop = Math.round(CFG.hopMs * fs / 1000);
    const w = new Float32Array(n); let sw = 0, sw2 = 0;
    for (let i = 0; i < n; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); sw += w[i]; sw2 += w[i] * w[i]; }
    const cs = FREQS.map((f) => { const c = new Float32Array(n), s = new Float32Array(n);
      for (let i = 0; i < n; i++) { c[i] = Math.cos(2 * Math.PI * f * i / fs) * w[i]; s[i] = Math.sin(2 * Math.PI * f * i / fs) * w[i]; }
      return [c, s]; });
    const frames = Math.max(0, Math.floor((y.length - n) / hop) + 1);
    const best = new Int8Array(frames), energy = new Float32Array(frames);
    const purity = new Float32Array(frames), ratio = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const o = f * hop; let e = 0;
      for (let i = 0; i < n; i++) { const v = y[o + i] * w[i]; e += v * v; }
      let p1 = 0, p2 = 0, k1 = 0;
      for (let k = 0; k < 16; k++) {
        const [c, s] = cs[k]; let re = 0, im = 0;
        for (let i = 0; i < n; i++) { re += y[o + i] * c[i]; im += y[o + i] * s[i]; }
        const p = re * re + im * im;
        if (p > p1) { p2 = p1; p1 = p; k1 = k; } else if (p > p2) p2 = p;
      }
      best[f] = k1; energy[f] = e;
      purity[f] = (p1 / (e + 1e-12)) * 2 * sw2 / (sw * sw);
      ratio[f] = 10 * Math.log10(p1 / (p2 + 1e-12) + 1e-12);
    }
    const sorted = Array.from(energy).sort((a, b) => a - b);
    const ref = (sorted[Math.floor(0.99 * (sorted.length - 1))] || 0) + 1e-12;
    const labels = new Int8Array(frames);
    for (let f = 0; f < frames; f++) {
      const ok = purity[f] > CFG.minPurity && ratio[f] > CFG.minRatioDb && 10 * Math.log10(energy[f] / ref + 1e-12) > -CFG.floorDb;
      labels[f] = ok ? best[f] : -1;
    }
    const times = Float64Array.from({ length: frames }, (_, f) => (f * hop + n / 2) / fs);
    return { times, labels };
  }
  function majority(labels, k) {
    const out = Int8Array.from(labels), h = k >> 1;
    for (let i = 0; i < labels.length; i++) {
      const votes = new Map();
      for (let j = Math.max(0, i - h); j <= Math.min(labels.length - 1, i + h); j++) votes.set(labels[j], (votes.get(labels[j]) || 0) + 1);
      let bestL = labels[i], bestV = votes.get(labels[i]);
      for (const [l, v] of votes) if (v > bestV) { bestL = l; bestV = v; }
      out[i] = bestL;
    }
    return out;
  }
  function runs(labels) {
    const r = []; let s = 0;
    for (let i = 1; i <= labels.length; i++) if (i === labels.length || labels[i] !== labels[s]) { r.push([labels[s], s, i]); s = i; }
    return r;
  }
  function readSpans(start, times, labels, spans) {
    let best = null;
    for (let d = -CFG.search; d <= CFG.search + 0.01; d += 1) {
      const picks = spans.map(([a, b]) => {
        const lo = start + (a + d) / 1000, hi = start + (b + d) / 1000;
        const counts = new Map(); let total = 0;
        for (let i = 0; i < times.length; i++) if (times[i] >= lo && times[i] <= hi) {
          total++; if (labels[i] >= 0) counts.set(labels[i], (counts.get(labels[i]) || 0) + 1);
        }
        let lab = -1, c = 0;
        for (const [l, v] of counts) if (v > c) { lab = l; c = v; }
        return [lab, total ? c / total : 0];
      });
      const score = picks.reduce((s, p) => s + p[1], 0);
      if (!best || score > best.score) best = { score, picks };
    }
    return best.picks;
  }
  function toCode(picks) {
    let code = "", prev = null;
    for (const [lab] of picks) { let t = lab >= 0 ? NAMES[lab] : "?"; if (t === "E" && prev) t = prev; code += t; prev = t; }
    return code;
  }
  function slotRead(start, times, labels) {
    const T = CFG.toneMs;
    const header = [0, 1, 2, 3, 4].map((k) => [k * T + 3, (k + 1) * T - 3]);
    const sep = [CFG.sepOffsetMs + 3, Math.min(CFG.sepOffsetMs + CFG.sepMs, CFG.finalOffsetMs) - 3];
    const body = Array.from({ length: CFG.maxBody }, (_, k) => [CFG.bodyOffsetMs + k * T + 3, CFG.bodyOffsetMs + (k + 1) * T - 3]);
    const pl = readSpans(start, times, labels, [...header, sep, ...body]);
    const sepPick = pl[5], bodyPicks = pl.slice(6);
    let nb = 0;
    // Echo tails repeat the previous tone (real repeats are sent as E); past 5
    // body tones, need a clearer tone.
    while (nb < bodyPicks.length && bodyPicks[nb][1] >= (nb < 5 ? 0.4 : 0.7) && (nb === 0 || bodyPicks[nb][0] !== bodyPicks[nb - 1][0])) nb++;
    if (sepPick[1] >= 0.6 && nb >= 3) {
      const used = [...pl.slice(0, 6), ...bodyPicks.slice(0, 5)];
      return { code: `${toCode(pl.slice(0, 5))}-${NAMES[sepPick[0]]}${toCode(bodyPicks.slice(0, nb))}`,
        kind: "appliance-msg", confidence: Math.min(...used.map((p) => p[1])),
        slots: [...pl.slice(0, 6), ...bodyPicks.slice(0, nb)] };
    }
    const ps = readSpans(start, times, labels, [...header, [CFG.finalOffsetMs + 3, CFG.finalOffsetMs + CFG.finalMs - 3]]);
    const code = toCode(ps);
    const kind = code[0] === "1" ? "station" : (code[0] === "C" || code[0] === "D") ? "appliance" : "unknown";
    return { code, kind, confidence: Math.min(...ps.map((p) => p[1])), slots: ps };
  }
  function decode(x, fs) {
    const y = bandpass(x, fs);
    const { times, labels: raw } = detect(y, fs);
    const hop = times.length > 1 ? times[1] - times[0] : 1;
    const labels = majority(raw, CFG.smooth);
    let rs = runs(labels);
    for (const r of rs) if (r[0] >= 0 && (r[2] - r[1]) * hop * 1000 < CFG.minToneMs) r[0] = -1;
    const merged = [];
    for (const r of rs) { if (merged.length && merged[merged.length - 1][0] === r[0]) merged[merged.length - 1][2] = r[2]; else merged.push(r.slice()); }
    const out = [];
    for (const r of merged) {
      const L = out.length;
      if (L >= 2 && r[0] >= 0 && out[L - 1][0] === -1 && out[L - 2][0] === r[0] && (out[L - 1][2] - out[L - 1][1]) * hop * 1000 < CFG.bridgeMs) { out.pop(); out[L - 2][2] = r[2]; }
      else out.push(r);
    }
    out.push([-1, labels.length, labels.length + 1e9]);
    const events = []; let cur = [];
    for (const [lab, s, e] of out) {
      if (lab < 0) {
        if ((e - s) * hop * 1000 >= CFG.burstGapMs && cur.length) {
          if (cur.length >= CFG.minTones) {
            const start = times[cur[0][1]];
            events.push({ start, ...slotRead(start, times, labels) });
          }
          cur = [];
        }
      } else cur.push([lab, s, e]);
    }
    return events;
  }

  const api = { TONES, NAMES, schedule, synth, decode, CFG };
  if (typeof module !== "undefined") module.exports = api; else root.SelCall = api;
})(this);
