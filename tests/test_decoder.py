import unittest

import numpy as np

from bench.synth import RF_FS, make_sdr_set
from selcall import decode_signal
from selcall.stream import StreamDecoder


def good(events):
    return [(round(e.start, 1), e.code) for e in events if e.confidence >= 0.5]


class DecoderTests(unittest.TestCase):
    def test_strong_signal_decodes_every_call_type(self):
        x, labels = make_sdr_set(n_bursts=30, cnr_db=15, seed=11)
        got = {c for _, c in good(decode_signal(x, RF_FS))}
        want = {c for _, c in labels}
        self.assertEqual(want, got & want)
        self.assertTrue(any("-" in c for c in want), "set should include long messages")

    def test_stream_matches_whole_file(self):
        x, _ = make_sdr_set(n_bursts=12, cnr_db=15, seed=3)
        whole = [c for _, c in good(decode_signal(x, RF_FS))]
        sd = StreamDecoder(RF_FS)
        streamed = []
        for i in range(0, len(x), 4096):  # odd chunk size on purpose
            streamed += sd.feed(x[i:i + 4096])
        streamed += sd.flush()
        self.assertEqual(whole, [e.code for e in streamed if e.confidence >= 0.5])
        starts = [e.start for e in streamed]
        self.assertEqual(starts, sorted(starts))

    def test_noise_only_produces_no_calls(self):
        rng = np.random.default_rng(0)
        self.assertEqual(good(decode_signal(rng.standard_normal(RF_FS * 5) * 0.3, RF_FS)), [])


if __name__ == "__main__":
    unittest.main()
