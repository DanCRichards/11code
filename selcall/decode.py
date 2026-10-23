"""Turn audio into SelCall codes: preprocess -> detect -> segment -> assemble."""

from dataclasses import dataclass, field

import numpy as np
from scipy import signal
from scipy.io import wavfile

from .detectors import DETECTORS
from .tones import TONE_FREQS, TONE_NAMES, REPEAT


@dataclass
class DecoderConfig:
    detector: str = "goertzel"
    params: dict = field(default_factory=dict)  # passed to the detector
    fs: int = 8000
    bandpass: bool = True
    smooth_frames: int = 3      # majority vote over this many frames (odd)
    min_tone_ms: float = 8.0    # shorter tone runs are discarded as glitches
    bridge_ms: float = 6.0      # gaps shorter than this inside one tone are bridged
    burst_gap_ms: float = 70.0  # silence longer than this ends a sequence
    min_tones: int = 4          # shorter sequences are ignored
    # "runs": code = every tone run in order. "slots": read each tone at its
    # known time position (FENZ format: 5 tones every 20 ms, then a final
    # tone ~137 ms after the first), which ignores echo tails and splits.
    # "matched": like slots, but decides each slot with a rectangular
    # Goertzel over exactly that slot's samples (a matched filter).
    assembler: str = "slots"
    tone_ms: float = 20.0
    final_offset_ms: float = 137.0
    final_ms: float = 35.0
    slot_search_ms: float = 6.0  # how far to slide the slot grid to fit
    # Long appliance messages ("13tone"): the same 5-tone header, then a long
    # separator tone straight after it, then body tones on a 20 ms grid.
    # Layout measured from two real messages; treat as provisional.
    sep_offset_ms: float = 105.0
    sep_ms: float = 55.0
    body_offset_ms: float = 165.0
    max_body: int = 7


@dataclass
class Event:
    start: float
    end: float
    code: str
    tones: list  # [(tone, start, duration_ms)]
    confidence: float = 1.0
    raw: str = ""  # run-based code, kept for diagnostics
    kind: str = ""  # "station", "appliance", "appliance-msg" or "unknown"


def load_wav(path):
    rate, x = wavfile.read(path)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if x.dtype.kind == "i":
        x = x / float(np.iinfo(x.dtype).max)
    elif x.dtype.kind == "u":
        x = (x - 128) / 128.0
    return rate, x.astype(np.float64)


def preprocess(x, rate, cfg):
    if rate != cfg.fs:
        g = np.gcd(int(rate), int(cfg.fs))
        x = signal.resample_poly(x, cfg.fs // g, int(rate) // g)
    if cfg.bandpass:
        sos = signal.butter(4, [850, 2500], "bandpass", fs=cfg.fs, output="sos")
        x = signal.sosfiltfilt(sos, x)
    return x


def _majority(labels, k):
    if k <= 1:
        return labels
    onehot = np.zeros((len(labels), len(TONE_NAMES) + 1))
    onehot[np.arange(len(labels)), labels + 1] = 1
    votes = signal.convolve(onehot, np.ones((k, 1)), mode="same")
    out = votes.argmax(axis=1) - 1
    # Keep the original label on ties so edges don't shift arbitrarily.
    tie = votes.max(axis=1) == votes[np.arange(len(labels)), labels + 1]
    return np.where(tie, labels, out)


def _runs(labels):
    if len(labels) == 0:
        return []
    edges = np.flatnonzero(np.diff(labels)) + 1
    starts = np.r_[0, edges]
    ends = np.r_[edges, len(labels)]
    return [[int(labels[s]), int(s), int(e)] for s, e in zip(starts, ends)]


def segment(times, labels, cfg, y=None):
    hop = times[1] - times[0] if len(times) > 1 else 1.0
    labels = _majority(np.asarray(labels), cfg.smooth_frames)
    runs = _runs(labels)
    for r in runs:
        if r[0] >= 0 and (r[2] - r[1]) * hop * 1000 < cfg.min_tone_ms:
            r[0] = -1
    # Merge neighbours with equal labels, then bridge short gaps within a tone.
    merged = []
    for r in runs:
        if merged and merged[-1][0] == r[0]:
            merged[-1][2] = r[2]
        else:
            merged.append(r)
    out = []
    for r in merged:
        if (len(out) >= 2 and r[0] >= 0 and out[-1][0] == -1 and out[-2][0] == r[0]
                and (out[-1][2] - out[-1][1]) * hop * 1000 < cfg.bridge_ms):
            out.pop()
            out[-1][2] = r[2]
        else:
            out.append(r)

    events, cur = [], []
    for lab, s, e in out + [[-1, len(labels), len(labels) + 10**9]]:
        if lab < 0:
            if (e - s) * hop * 1000 >= cfg.burst_gap_ms and cur:
                ev = _assemble(cur, times, hop)
                if ev and len(ev.code) >= cfg.min_tones:
                    if cfg.assembler == "slots":
                        _slot_read(ev, times, labels, cfg)
                    elif cfg.assembler == "matched":
                        _matched_read(ev, y, cfg)
                    events.append(ev)
                cur = []
        else:
            cur.append((lab, s, e))
    return events


def _assemble(segs, times, hop):
    code, tones, prev = "", [], None
    for lab, s, e in segs:
        t = TONE_NAMES[lab]
        tones.append((t, float(times[s]), (e - s) * hop * 1000))
        if t == REPEAT and prev is not None:
            t = prev
        code += t
        prev = t
    t0 = float(times[segs[0][1]])
    t1 = float(times[min(segs[-1][2], len(times) - 1)])
    return Event(t0, t1, code, tones, raw=code)


def _read_spans(ev, times, labels, spans, search_ms):
    """Majority tone in each (start_ms, end_ms) span relative to ev.start,
    sliding the whole grid up to +/-search_ms to the best fit.
    Returns [(label, coverage)]."""
    best = None
    for d in np.arange(-search_ms, search_ms + 0.1, 1.0):
        picks = []
        for a, b in spans:
            m = (times >= ev.start + (a + d) / 1000) & (times <= ev.start + (b + d) / 1000)
            lab = labels[m]
            tones = lab[lab >= 0]
            if len(lab) == 0 or len(tones) == 0:
                picks.append((-1, 0.0))
                continue
            vals, counts = np.unique(tones, return_counts=True)
            picks.append((int(vals[counts.argmax()]), counts.max() / len(lab)))
        score = sum(c for _, c in picks)
        if best is None or score > best[0]:
            best = (score, picks)
    return best[1]


def _slot_read(ev, times, labels, cfg):
    """Re-read an event's code from fixed time slots, and record the weakest
    slot's coverage as confidence. Chooses between the 6-tone layout
    (stations, short appliance calls) and the long appliance layout."""
    T = cfg.tone_ms
    header = [(k * T + 3, (k + 1) * T - 3) for k in range(5)]
    short = header + [(cfg.final_offset_ms + 3, cfg.final_offset_ms + cfg.final_ms - 3)]
    # The separator window stops before a short call's final tone would start.
    sep = (cfg.sep_offset_ms + 3, min(cfg.sep_offset_ms + cfg.sep_ms, cfg.final_offset_ms) - 3)
    body = [(cfg.body_offset_ms + k * T + 3, cfg.body_offset_ms + (k + 1) * T - 3)
            for k in range(cfg.max_body)]
    picks_long = _read_spans(ev, times, labels, header + [sep] + body, cfg.slot_search_ms)
    sep_pick, body_picks = picks_long[5], picks_long[6:]
    n_body = 0
    # A slot repeating the previous raw tone is an echo tail: real repeats are
    # sent as E, so the body ends there.
    while (n_body < len(body_picks) and body_picks[n_body][1] >= 0.4
           and (n_body == 0 or body_picks[n_body][0] != body_picks[n_body - 1][0])):
        n_body += 1
    is_long = sep_pick[1] >= 0.6 and n_body >= 3
    if is_long:
        ev.raw = ev.code
        head, _ = _tones_to_code(picks_long[:5])
        body_code, _ = _tones_to_code(body_picks[:n_body])
        sep_code = TONE_NAMES[sep_pick[0]]
        ev.code = f"{head}-{sep_code}{body_code}"
        # Confidence covers the header, separator and the first 5 body slots
        # (missing body slots count against it).
        ev.confidence = float(min(c for _, c in picks_long[:6] + body_picks[:5]))
        ev.kind = "appliance-msg"
    else:
        _apply_picks(ev, _read_spans(ev, times, labels, short, cfg.slot_search_ms))
        ev.kind = {"1": "station", "C": "appliance", "D": "appliance"}.get(ev.code[:1], "unknown")


def _slot_spans(cfg, pad):
    spans = [(k * cfg.tone_ms + pad, (k + 1) * cfg.tone_ms - pad) for k in range(5)]
    spans.append((cfg.final_offset_ms + pad, cfg.final_offset_ms + cfg.final_ms - pad))
    return spans


def _matched_read(ev, y, cfg):
    """Slide the slot grid around the detected onset; in each slot measure all
    16 tones over exactly the slot's samples and keep the best-fitting grid."""
    fs = cfg.fs
    spans = _slot_spans(cfg, 1.5)
    best = None
    for d in np.arange(-cfg.slot_search_ms - 8, cfg.slot_search_ms + 0.1, 1.0):
        picks = []
        for a, b in spans:
            i0 = int(round((ev.start + (a + d) / 1000) * fs))
            i1 = int(round((ev.start + (b + d) / 1000) * fs))
            if i0 < 0 or i1 > len(y) or i1 - i0 < 8:
                picks.append((-1, 0.0))
                continue
            seg = y[i0:i1]
            n = np.arange(len(seg))
            p = np.abs(np.exp(-2j * np.pi * np.outer(TONE_FREQS, n) / fs) @ seg) ** 2
            purity = p.max() / (np.sum(seg**2) * len(seg) / 2 + 1e-12)
            picks.append((int(p.argmax()), float(min(purity, 1.0))))
        score = sum(c for _, c in picks)
        if best is None or score > best[0]:
            best = (score, picks)
    _apply_picks(ev, best[1])


def _tones_to_code(picks):
    """Slot picks -> code string, resolving E (repeat) within the group."""
    code, prev = "", None
    for lab, _ in picks:
        t = TONE_NAMES[lab] if lab >= 0 else "?"
        if t == REPEAT and prev is not None:
            t = prev
        code += t
        prev = t
    return code, (min(c for _, c in picks) if picks else 0.0)


def _apply_picks(ev, picks):
    code, conf = _tones_to_code(picks)
    ev.raw, ev.code = ev.code, code
    ev.confidence = float(conf)


def decode_signal(x, rate, cfg=None):
    cfg = cfg or DecoderConfig()
    y = preprocess(x, rate, cfg)
    times, labels, _ = DETECTORS[cfg.detector](y, cfg.fs, **cfg.params)
    return segment(times, labels, cfg, y)


def decode_file(path, cfg=None):
    rate, x = load_wav(path)
    return decode_signal(x, rate, cfg)
