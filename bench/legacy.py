"""The original SepacDecoder.py algorithm, ported to return codes instead of
printing, so it can be scored alongside the new decoders. Behaviour is kept
as-is (including the tonenone counter never resetting), except `e_hz` lets
the E-tone fix be tested on its own."""

import numpy as np
from scipy import signal

FRAMES = 1024


def legacy_decode(x, rate, e_hz=2210):
    ref = {'1': 1124, '2': 1197, '3': 1275, '4': 1358, '5': 1446, '6': 1540,
           '7': 1640, '8': 1747, '9': 1860, '0': 1981, 'A': 2400, 'B': 930,
           'C': 2247, 'D': 991, 'E': e_hz, 'F': 1055}
    if rate != 44100:
        g = np.gcd(int(rate), 44100)
        x = signal.resample_poly(x, 44100 // g, int(rate) // g)
        rate = 44100
    pcm = np.clip(x * 32767, -32768, 32767).astype(np.int16).astype(float)
    window = np.blackman(FRAMES)
    events, train, tonenone = [], [], 0
    train_start = None

    def flush(t):
        last, collapsed = None, []
        for tone in train:
            if tone != last:
                collapsed.append(tone)
            last = tone
        if len(collapsed) < 5:
            return
        code, last = "", None
        for tone in collapsed:
            if tone == 'E' and last:
                tone = last
            last = tone
            code += tone
        events.append((train_start, code))

    for i in range(0, len(pcm) - FRAMES + 1, FRAMES):
        fft = np.abs(np.fft.rfft(pcm[i:i + FRAMES] * window)) ** 2
        which = fft[1:].argmax() + 1
        if which != len(fft) - 1:
            with np.errstate(all="ignore"):
                y0, y1, y2 = np.log(fft[which - 1:which + 2])
                x1 = (y2 - y0) * .5 / (2 * y1 - y2 - y0)
            freq = (which + x1) * rate / FRAMES
        else:
            freq = which * rate / FRAMES
        freq = 10 if freq != freq else int(round(freq))
        tone = next((t for t, f in ref.items() if f - 14 <= freq <= f + 14), None)
        t = i / rate
        if tone:
            if not train:
                train_start = t
            train.append(tone)
        elif train and tonenone == 3:
            flush(t)
            train, tonenone = [], 0
        elif train:
            tonenone += 1
    if train:
        flush(len(pcm) / rate)
    return events
