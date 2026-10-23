"""Score decoder variants on the real recordings and on synthetic sets.

    python -m bench.run            # full grid
    python -m bench.run --quick    # fewer synthetic conditions
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from bench.legacy import legacy_decode
from bench.synth import RF_FS, make_sdr_set
from selcall.decode import DecoderConfig, decode_signal, load_wav

ROOT = Path(__file__).resolve().parent.parent
MIN_CONF = 0.5  # slot decodes below this are reported as "flagged", not trusted


def candidates():
    c = {
        "legacy (as-is)": lambda x, r: [(t, k, 1.0) for t, k in legacy_decode(x, r)],
        "legacy + E=2110": lambda x, r: [(t, k, 1.0) for t, k in legacy_decode(x, r, 2110)],
    }

    def new(name, **kw):
        cfg = DecoderConfig(**kw)
        c[name] = lambda x, r, cfg=cfg: [(e.start, e.code, e.confidence)
                                         for e in decode_signal(x, r, cfg)]

    for asm in ("runs", "slots"):
        for w in (10, 15, 20, 25):
            new(f"goertzel {w}ms {asm}", detector="goertzel", assembler=asm,
                params={"win_ms": w})
        for w in (10, 15, 20):
            new(f"fft {w}ms {asm}", detector="fft", assembler=asm, params={"win_ms": w})
        for w in (5, 8, 12):
            new(f"instfreq {w}ms {asm}", detector="instfreq", assembler=asm,
                params={"win_ms": w, "tol_hz": 35, "max_spread_hz": 150})
    for w in (10, 15, 20):
        new(f"goertzel {w}ms matched", detector="goertzel", assembler="matched",
            params={"win_ms": w})
        new(f"goertzel {w}ms boxcar slots", detector="goertzel", assembler="slots",
            params={"win_ms": w, "window": "boxcar"})
    new("fft 15ms matched", detector="fft", assembler="matched", params={"win_ms": 15})
    new("instfreq 8ms matched", detector="instfreq", assembler="matched",
        params={"win_ms": 8, "tol_hz": 35, "max_spread_hz": 150})
    for p in (0.3, 0.6):
        new(f"goertzel 15ms slots purity{p}", detector="goertzel", assembler="slots",
            params={"win_ms": 15, "min_purity": p})
    for r in (2.0, 8.0):
        new(f"goertzel 15ms slots ratio{r:g}dB", detector="goertzel", assembler="slots",
            params={"win_ms": 15, "min_ratio_db": r})
    new("goertzel 15ms slots nosmooth", detector="goertzel", assembler="slots",
        smooth_frames=1, params={"win_ms": 15})
    new("goertzel 15ms slots no-bandpass", detector="goertzel", assembler="slots",
        bandpass=False, params={"win_ms": 15})
    new("goertzel 15ms slots 16kHz", detector="goertzel", assembler="slots",
        fs=16000, params={"win_ms": 15})
    return c


def score(events, labels):
    """labels: [(t, code or None, end or None)]. Returns counts dict."""
    s = dict(correct=0, wrong=0, flagged=0, missed=0, false=0)
    used = set()
    for t, code, end in labels:
        hits = [i for i, (et, _, _) in enumerate(events)
                if i not in used and t - 0.06 <= et <= (end or t + 0.12)]
        used.update(hits)
        if code is None:
            continue
        if not hits:
            s["missed"] += 1
            continue
        _, got, conf = events[hits[0]]
        if conf < MIN_CONF or "?" in got:
            s["flagged"] += 1
        elif got == code:
            s["correct"] += 1
        else:
            s["wrong"] += 1
    s["false"] = sum(1 for i, (_, k, conf) in enumerate(events)
                     if i not in used and conf >= MIN_CONF and "?" not in k)
    return s


def real_sets():
    labels = json.loads((ROOT / "bench/labels.json").read_text())
    out = []
    for name, labs in labels.items():
        if name.startswith("_"):
            continue
        r, x = load_wav(ROOT / f"recordings/{name}.wav")
        out.append((name, x, r, [(l["t"], l["code"], l.get("end")) for l in labs]))
    return out


def synth_sets(quick):
    """Bursts over a simulated narrowband FM link (SDR input), from a strong
    signal down past the FM threshold, with open-squelch noise and voice."""
    cnrs = (10, 5, 3) if quick else (20, 10, 7, 5, 4, 3, 2)
    out = []
    for i, cnr in enumerate(cnrs):
        x, labs = make_sdr_set(n_bursts=40, cnr_db=cnr, seed=200 + i)
        out.append((f"cnr{cnr}", x, RF_FS, [(t, c, None) for t, c in labs]))
    return out


def run(quick=False, only=None):
    real, synth = real_sets(), synth_sets(quick)
    rows = []
    for name, fn in candidates().items():
        if only and only not in name:
            continue
        tot = {"real": dict(correct=0, wrong=0, flagged=0, missed=0, false=0),
               "synth": dict(correct=0, wrong=0, flagged=0, missed=0, false=0)}
        per_cond, audio_s, cpu_s = {}, 0.0, 0.0
        for kind, sets in (("real", real), ("synth", synth)):
            for sname, x, r, labs in sets:
                t0 = time.perf_counter()
                ev = fn(x, r)
                cpu_s += time.perf_counter() - t0
                audio_s += len(x) / r
                s = score(ev, labs)
                per_cond[sname] = s
                for k in s:
                    tot[kind][k] += s[k]
        rows.append((name, tot, per_cond, audio_s / cpu_s))
        print(fmt_row(name, tot, audio_s / cpu_s), flush=True)
    return rows, real, synth


def fmt_row(name, tot, speed):
    def pct(d, k):
        n = d["correct"] + d["wrong"] + d["flagged"] + d["missed"]
        return 100 * d[k] / n if n else 0
    r, s = tot["real"], tot["synth"]
    return (f"{name:34s} real {r['correct']:2d}/9 ok {r['wrong']} wrong {r['false']} FA | "
            f"synth {pct(s,'correct'):5.1f}% ok {pct(s,'wrong'):4.1f}% wrong "
            f"{pct(s,'flagged'):4.1f}% flag {pct(s,'missed'):4.1f}% miss {s['false']:3d} FA | "
            f"{speed:6.0f}x realtime")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--json")
    a = ap.parse_args()
    rows, _, _ = run(a.quick, a.only)
    if a.json:
        Path(a.json).write_text(json.dumps(
            [{"name": n, "totals": t, "per_condition": p, "speed_x_realtime": sp}
             for n, t, p, sp in rows], indent=1))
