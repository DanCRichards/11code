"""Synthetic FENZ SelCall bursts with controllable impairments.

Format (measured from real recordings): 5 tones every 20 ms, then a final
tone starting ~137 ms after the first, ~45 ms long. Repeats within the first
five use the E tone; the final tone is sent plainly.
"""

import numpy as np
from scipy import signal

from selcall.tones import CCIR

SYMBOLS = [t for t in CCIR if t != "E"]


def encode(code):
    out, prev = [], None
    for t in code[:5]:
        out.append("E" if t == prev else t)
        prev = t
    return out, code[5]


def random_code(rng):
    if rng.random() < 0.5:  # station-style
        return "18" + "".join(rng.choice(list("0123456789"), 4))
    return "C" + "".join(rng.choice(SYMBOLS, 4)) + rng.choice(list("24BC"))


def burst(code, fs, rng, tone_ms=20.0, final_offset_ms=137.0, final_ms=45.0,
          jitter=0.0, freq_offset=0.0, twist_db=0.0):
    scale = 1 + rng.uniform(-jitter, jitter)
    main, final = encode(code)
    parts = [(t, k * tone_ms * scale, tone_ms * scale) for k, t in enumerate(main)]
    parts.append((final, final_offset_ms * scale, final_ms))
    total = int((final_offset_ms * scale + final_ms) / 1000 * fs) + 1
    y = np.zeros(total)
    phase = 0.0
    for t, start_ms, dur_ms in parts:
        a, b = int(start_ms / 1000 * fs), int((start_ms + dur_ms) / 1000 * fs)
        f = CCIR[t] + freq_offset
        amp = 10 ** (rng.uniform(-twist_db, twist_db) / 20)
        n = np.arange(b - a)
        y[a:b] = amp * np.sin(phase + 2 * np.pi * f * n / fs)
        phase += 2 * np.pi * f * (b - a) / fs  # continuous phase, like a real encoder
    return y


def reverb_ir(fs, rt60, rng, drr_db=0.0):
    """Direct path plus an exponentially decaying diffuse tail whose total
    energy sits `drr_db` below the direct sound."""
    if rt60 <= 0:
        return np.array([1.0])
    n = int(rt60 * fs)
    t = np.arange(n) / fs
    tail = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    tail[: int(0.002 * fs)] = 0  # first reflections arrive after ~2 ms
    tail *= np.sqrt(10 ** (-drr_db / 10) / np.sum(tail**2))
    tail[0] = 1.0
    return tail


def make_set(n_bursts=40, fs=44100, snr_db=20.0, rt60=0.0, drr_db=0.0, jitter=0.05,
             max_offset_hz=10.0, twist_db=3.0, clicks=True, seed=0):
    """Returns (signal, labels) where labels = [(start_s, code)]."""
    rng = np.random.default_rng(seed)
    spacing = 1.0
    x = np.zeros(int((n_bursts * spacing + 1.0) * fs))
    labels = []
    ir = reverb_ir(fs, rt60, rng, drr_db)
    for i in range(n_bursts):
        code = random_code(rng)
        b = burst(code, fs, rng, jitter=jitter,
                  freq_offset=rng.uniform(-max_offset_hz, max_offset_hz), twist_db=twist_db)
        b = signal.fftconvolve(b, ir)[: len(b) + len(ir) - 1]
        t0 = 0.5 + i * spacing + rng.uniform(0, 0.2)
        a = int(t0 * fs)
        x[a:a + len(b)] += b[: len(x) - a]
        labels.append((t0, code))
    # Noise power relative to an un-reverberated tone (amplitude 1 -> power 0.5).
    x += rng.standard_normal(len(x)) * np.sqrt(0.5 / 10 ** (snr_db / 10))
    if clicks:
        for _ in range(n_bursts * 2):
            c = rng.integers(0, len(x) - 50)
            x[c:c + 20] += rng.uniform(-3, 3) * np.hanning(20)
    x /= np.max(np.abs(x)) * 1.05
    return x, labels
