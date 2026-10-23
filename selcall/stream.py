"""Decode a continuous audio stream (e.g. rtl_fm output) in chunks.

Keeps the last few seconds of audio, re-decodes it every `hop_s`, and emits
each call once it is safely complete, with its absolute stream time.
"""

import numpy as np

from .decode import DecoderConfig, decode_signal


class StreamDecoder:
    def __init__(self, rate, cfg=None, window_s=2.5, hop_s=0.5, settle_s=0.6):
        self.rate = rate
        self.cfg = cfg or DecoderConfig()
        self.window = int(window_s * rate)
        self.hop = int(hop_s * rate)
        self.settle = settle_s       # a call must end this long before the buffer end
        self.buf = np.zeros(0)
        self.buf_start = 0.0         # stream time of buf[0], seconds
        self.pending = 0             # samples received since the last decode
        self.emitted = []            # start times already reported

    def feed(self, samples):
        """Add samples (float, -1..1). Returns newly completed events, each
        with .start/.end in seconds since the stream began."""
        self.buf = np.concatenate([self.buf, np.asarray(samples, dtype=np.float64)])
        self.pending += len(samples)
        out = []
        while self.pending >= self.hop:
            self.pending -= self.hop
            out += self._decode(final=False)
        return out

    def flush(self):
        """Decode whatever is left (end of stream)."""
        return self._decode(final=True)

    def _decode(self, final):
        if len(self.buf) == 0:
            return []
        end = self.buf_start + len(self.buf) / self.rate
        out = []
        for ev in decode_signal(self.buf, self.rate, self.cfg):
            ev.start += self.buf_start
            ev.end += self.buf_start
            if not final and ev.start > end - self.settle:
                continue  # may still be arriving; next pass will see all of it
            if self.buf_start > 0 and ev.start < self.buf_start + 0.4:
                continue  # front cut off by the window; already reported when whole
            if any(abs(ev.start - t) < 0.15 for t in self.emitted):
                continue
            self.emitted.append(ev.start)
            out.append(ev)
        if len(self.buf) > self.window:
            drop = len(self.buf) - self.window
            self.buf = self.buf[drop:]
            self.buf_start += drop / self.rate
        self.emitted = [t for t in self.emitted if t > self.buf_start - 1.0]
        return out
