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


# --- FM radio link (what an SDR actually hears) -----------------------------

RF_FS = 48000
DEVIATION_HZ = 2000     # tone deviation on a 12.5 kHz narrowband channel
EMPH_TAU = 530e-6       # 6 dB/octave land-mobile pre-/de-emphasis


def _preemphasis(x, fs):
    # H(z) ~ (1 + tau*s), normalised so ~1 kHz is roughly unity gain.
    a = np.exp(-1 / (EMPH_TAU * fs))
    y = signal.lfilter([1, -a], [1], x)
    return y / np.abs(1 - a * np.exp(-2j * np.pi * 1000 / fs))


def _deemphasis(x, fs):
    a = np.exp(-1 / (EMPH_TAU * fs))
    y = signal.lfilter([1 - a], [1, -a], x)
    return y / np.abs((1 - a) / (1 - a * np.exp(-2j * np.pi * 1000 / fs)))


def fake_voice(n, fs, rng):
    """Vowel-like harmonic stacks with gliding pitch and syllable envelopes."""
    t = np.arange(n) / fs
    f0 = rng.uniform(90, 220) * (1 + 0.15 * np.sin(2 * np.pi * rng.uniform(0.5, 3) * t))
    ph = 2 * np.pi * np.cumsum(f0) / fs
    v = sum(np.sin(h * ph) / h for h in range(1, 25))
    b, a = signal.butter(2, [rng.uniform(300, 700), rng.uniform(1500, 2800)], "bandpass", fs=fs)
    v = signal.lfilter(b, a, v)
    env = np.clip(np.sin(2 * np.pi * rng.uniform(3, 6) * t), 0, None) ** 0.5
    return v * env / (np.std(v) + 1e-9) * 0.5


def fm_link(audio, keyed, cnr_db, rng, fs=RF_FS):
    """audio: baseband message (|peak| ~ 1). keyed: bool mask, carrier present.
    Returns demodulated, de-emphasised audio at `fs`."""
    m = _preemphasis(audio, fs)
    m = np.clip(m, -1.5, 1.5)  # transmitter deviation limiter
    phase = 2 * np.pi * DEVIATION_HZ * np.cumsum(m) / fs
    carrier_offset = rng.uniform(-500, 500)  # SDR tuning error
    z = np.exp(1j * (phase + 2 * np.pi * carrier_offset * np.arange(len(m)) / fs)) * keyed
    # Noise power set relative to the carrier within the 12.5 kHz channel.
    noise_bw_frac = 12500 / fs
    sigma = np.sqrt(10 ** (-cnr_db / 10) / noise_bw_frac / 2)
    z = z + sigma * (rng.standard_normal(len(z)) + 1j * rng.standard_normal(len(z)))
    sos = signal.butter(6, 6250, fs=fs, output="sos")
    z = signal.sosfilt(sos, z)
    disc = np.angle(z[1:] * np.conj(z[:-1])) * fs / (2 * np.pi * DEVIATION_HZ)
    out = _deemphasis(np.r_[0, disc], fs)
    sos = signal.butter(6, [250, 3000], "bandpass", fs=fs, output="sos")
    return signal.sosfilt(sos, out)


def make_sdr_set(n_bursts=30, cnr_db=15.0, voice=True, max_offset_hz=8.0,
                 jitter=0.03, seed=0):
    """Bursts sent over a simulated narrowband FM link. Carrier is keyed only
    around each burst (and voice), so the gaps are open-squelch noise."""
    rng = np.random.default_rng(seed)
    fs = RF_FS
    spacing = 1.2
    n = int((n_bursts * spacing + 1.0) * fs)
    audio = np.zeros(n)
    keyed = np.zeros(n)
    labels = []
    for i in range(n_bursts):
        code = random_code(rng)
        b = burst(code, fs, rng, jitter=jitter,
                  freq_offset=rng.uniform(-max_offset_hz, max_offset_hz), twist_db=1.0)
        t0 = 0.5 + i * spacing + rng.uniform(0, 0.1)
        a = int(t0 * fs)
        audio[a:a + len(b)] += 0.7 * b
        keyed[a - int(0.15 * fs):a + len(b) + int(0.1 * fs)] = 1
        labels.append((t0, code))
        if voice and rng.random() < 0.6:  # a voice transmission in the gap
            va = a + len(b) + int(0.2 * fs)
            vn = int(rng.uniform(0.4, 0.7) * fs)
            audio[va:va + vn] += fake_voice(vn, fs, rng)
            keyed[va - int(0.05 * fs):va + vn + int(0.05 * fs)] = 1
    y = fm_link(audio, keyed, cnr_db, rng, fs)
    return y / (np.max(np.abs(y)) * 1.05), labels
