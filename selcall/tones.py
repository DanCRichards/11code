"""CCIR 5-tone frequency table.

E (2110 Hz) is the repeat tone: it stands in for a digit identical to the one
before it, since the same tone can't be sent twice in a row.
"""

import numpy as np

CCIR = {
    "1": 1124, "2": 1197, "3": 1275, "4": 1358, "5": 1446,
    "6": 1540, "7": 1640, "8": 1747, "9": 1860, "0": 1981,
    "A": 2400, "B": 930, "C": 2247, "D": 991, "E": 2110, "F": 1055,
}

TONE_NAMES = list(CCIR)
TONE_FREQS = np.array([CCIR[t] for t in TONE_NAMES], dtype=float)
REPEAT = "E"
