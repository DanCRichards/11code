"""Per-frame tone detectors.

Each detector takes a mono float signal (already band-passed, at `fs`) and
returns (times, labels, quality):
  times   - centre time of each analysis frame, seconds
  labels  - index into TONE_FREQS, or -1 for "no tone"
  quality - detector-specific confidence in [0, 1]
"""

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from scipy import signal

from .tones import TONE_FREQS


def _frames(x, n, hop):
    if len(x) < n:
        return np.empty((0, n))
    return sliding_window_view(x, n)[::hop]


def _level_gate(energy, floor_db):
    """True where frame energy is within `floor_db` of the loudest frames."""
    ref = np.percentile(energy, 99) + 1e-12
    return 10 * np.log10(energy / ref + 1e-12) > -floor_db


def goertzel(x, fs, win_ms=15, hop_ms=2.5, min_purity=0.45, min_ratio_db=2.0,
             floor_db=40, window="hann"):
    """Bank of 16 single-frequency DFTs (Goertzel) at the exact CCIR tones.

    Accepts a frame only if the best tone carries most of the in-band energy
    (purity) and clearly beats the runner-up (ratio).
    """
    n = int(round(win_ms * fs / 1000))
    hop = max(1, int(round(hop_ms * fs / 1000)))
    w = signal.get_window(window, n)
    k = np.exp(-2j * np.pi * np.outer(np.arange(n), TONE_FREQS) / fs) * w[:, None]
    fr = _frames(x, n, hop)
    power = np.abs(fr @ k) ** 2
    energy = np.sum((fr * w) ** 2, axis=1)
    # Normalise so a pure tone at an exact CCIR frequency gives purity 1.0.
    purity = power.max(axis=1) / (energy + 1e-12) * 2 * np.sum(w**2) / np.sum(w) ** 2
    top2 = np.sort(power, axis=1)[:, -2:]
    ratio_db = 10 * np.log10(top2[:, 1] / (top2[:, 0] + 1e-12) + 1e-12)
    ok = (purity > min_purity) & (ratio_db > min_ratio_db) & _level_gate(energy, floor_db)
    labels = np.where(ok, power.argmax(axis=1), -1)
    times = (np.arange(len(fr)) * hop + n / 2) / fs
    return times, labels, np.clip(purity, 0, 1)


def fft_peak(x, fs, win_ms=15, hop_ms=2.5, tol_hz=25, min_purity=0.45, floor_db=40,
             nfft=4096):
    """Strongest FFT peak in the tone band, refined by parabolic interpolation,
    then snapped to the nearest CCIR tone within `tol_hz`."""
    n = int(round(win_ms * fs / 1000))
    hop = max(1, int(round(hop_ms * fs / 1000)))
    w = signal.get_window("hann", n)
    fr = _frames(x, n, hop)
    spec = np.abs(np.fft.rfft(fr * w, nfft, axis=1)) ** 2
    freqs = np.fft.rfftfreq(nfft, 1 / fs)
    band = (freqs > 880) & (freqs < 2460)
    lo = np.argmax(band)
    sb = spec[:, band]
    i = sb.argmax(axis=1)
    i = np.clip(i, 1, sb.shape[1] - 2)
    rows = np.arange(len(sb))
    y0, y1, y2 = (np.log(sb[rows, i + d] + 1e-20) for d in (-1, 0, 1))
    delta = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-20)
    f = freqs[lo + i] + np.clip(delta, -1, 1) * (fs / nfft)
    dist = np.abs(f[:, None] - TONE_FREQS[None, :])
    nearest = dist.argmin(axis=1)
    energy = np.sum((fr * w) ** 2, axis=1)
    # Fraction of band energy within +/-tol of the peak.
    near = np.abs(freqs[band][None, :] - f[:, None]) < max(tol_hz, fs / n)
    purity = (sb * near).sum(axis=1) / (sb.sum(axis=1) + 1e-12)
    ok = (dist[rows, nearest] <= tol_hz) & (purity > min_purity) & _level_gate(energy, floor_db)
    labels = np.where(ok, nearest, -1)
    times = (np.arange(len(fr)) * hop + n / 2) / fs
    return times, labels, np.clip(purity, 0, 1)


def inst_freq(x, fs, win_ms=8, hop_ms=2.5, tol_hz=25, max_spread_hz=40, floor_db=40):
    """Instantaneous frequency from the analytic signal's phase derivative.

    For a single clean tone this resolves frequency to a few Hz even over a
    few ms; mixtures (echo, overlap) show up as a large spread.
    """
    z = signal.hilbert(x)
    dphi = np.angle(z[1:] * np.conj(z[:-1]))
    fi = dphi * fs / (2 * np.pi)
    amp = np.abs(z[1:])
    n = int(round(win_ms * fs / 1000))
    hop = max(1, int(round(hop_ms * fs / 1000)))
    ff = _frames(fi, n, hop)
    aa = _frames(amp, n, hop)
    med = np.median(ff, axis=1)
    spread = np.percentile(ff, 75, axis=1) - np.percentile(ff, 25, axis=1)
    dist = np.abs(med[:, None] - TONE_FREQS[None, :])
    nearest = dist.argmin(axis=1)
    rows = np.arange(len(ff))
    ok = ((dist[rows, nearest] <= tol_hz) & (spread < max_spread_hz)
          & _level_gate(np.mean(aa**2, axis=1), floor_db))
    labels = np.where(ok, nearest, -1)
    times = (np.arange(len(ff)) * hop + n / 2) / fs
    return times, labels, np.clip(1 - spread / max_spread_hz, 0, 1)


DETECTORS = {"goertzel": goertzel, "fft": fft_peak, "instfreq": inst_freq}
