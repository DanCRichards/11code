"""Run the turnout board backend.

    # API + web app, no radio (edit the codebook, accept calls over POST)
    python -m server --static web/dist

    # Live from an RTL-SDR (set the frequency for your channel)
    rtl_fm -f 141.000M -M fm -s 22050 -l 0 | python -m server --audio-stdin --rate 22050 --static web/dist

    # Replay a recording in real time (handy for testing the UI)
    python -m server --audio-file recordings/059dbcae.wav --loop --static web/dist
"""

import argparse
import os
import secrets
import shutil
import sys
import threading
import time
from pathlib import Path

import numpy as np

from selcall.decode import load_wav
from selcall.stream import StreamDecoder

from .app import Hub, serve
from .store import Store

ROOT = Path(__file__).resolve().parent.parent
MIN_CONFIDENCE = 0.5


def audio_loop(source, rate, store, hub, status, loop=False):
    """Feed audio into the stream decoder and publish each decoded call."""
    status["decoder"] = "running"
    sd = StreamDecoder(rate)
    try:
        while True:
            for block in source():
                for ev in sd.feed(block):
                    if ev.confidence < MIN_CONFIDENCE:
                        status["unreadable"] = status.get("unreadable", 0) + 1
                        continue
                    call = store.add_call(ev.code, ev.kind, ev.confidence, "decoder", audio_time=ev.start)
                    status["decoded"] = status.get("decoded", 0) + 1
                    hub.publish("call", call)
                    print(f"call {call['code']:>14}  {call['kind']:<13} {ev.confidence:.2f}", flush=True)
            for ev in sd.flush():
                if ev.confidence >= MIN_CONFIDENCE:
                    hub.publish("call", store.add_call(ev.code, ev.kind, ev.confidence, "decoder"))
            if not loop:
                break
            sd = StreamDecoder(rate)
    finally:
        status["decoder"] = "stopped"


def stdin_source(rate):
    def gen():
        n = rate // 10 * 2  # 100 ms of 16-bit mono
        while True:
            data = sys.stdin.buffer.read(n)
            if not data:
                return
            yield np.frombuffer(data[: len(data) // 2 * 2], dtype="<i2") / 32768.0
    return gen


def file_source(path):
    rate, x = load_wav(path)

    def gen():
        step = rate // 10
        t0 = time.monotonic()
        for i in range(0, len(x), step):
            delay = t0 + i / rate - time.monotonic()
            if delay > 0:
                time.sleep(delay)  # real time, so the board sees calls arrive naturally
            yield x[i:i + step]
        yield np.zeros(rate)  # trailing silence so the last call completes
    return rate, gen


def main():
    ap = argparse.ArgumentParser(description="Turnout board backend: decoder + codebook API")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--data-dir", default=str(ROOT / "server-data"),
                    help="where the codebook and call log are kept")
    ap.add_argument("--static", help="folder of the built web app to serve (web/dist)")
    ap.add_argument("--cors-origin", default="*",
                    help="origin allowed to call the API, e.g. https://you.github.io")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--audio-stdin", action="store_true", help="read raw s16le mono audio from stdin")
    src.add_argument("--audio-file", help="replay a WAV file in real time")
    ap.add_argument("--rate", type=int, default=22050, help="sample rate of --audio-stdin")
    ap.add_argument("--loop", action="store_true", help="repeat --audio-file forever")
    a = ap.parse_args()

    data_dir = Path(a.data_dir)
    if not (data_dir / "codebook.json").exists():
        data_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "data/codebook.json", data_dir / "codebook.json")
    store, hub = Store(data_dir), Hub()

    api_key = os.environ.get("SELCALL_API_KEY")
    if not api_key:
        api_key = secrets.token_urlsafe(18)
        print(f"No SELCALL_API_KEY set. Editing key for this run: {api_key}")

    status = {"decoder": "off", "decoded": 0, "unreadable": 0}
    if a.audio_stdin:
        threading.Thread(target=audio_loop, args=(stdin_source(a.rate), a.rate, store, hub, status),
                         daemon=True).start()
    elif a.audio_file:
        rate, gen = file_source(a.audio_file)
        threading.Thread(target=audio_loop, args=(gen, rate, store, hub, status, a.loop),
                         daemon=True).start()

    httpd = serve(store, hub, a.host, a.port, api_key, a.static, a.cors_origin, status)
    print(f"Turnout board backend on http://{a.host}:{a.port}  (data: {data_dir})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
