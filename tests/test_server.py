import json
import shutil
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from urllib.error import HTTPError

from server.app import Hub, serve
from server.store import Store

ROOT = Path(__file__).resolve().parent.parent
KEY = "test-key"


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        shutil.copy(ROOT / "data/codebook.json", Path(self.tmp) / "codebook.json")
        self.store, self.hub = Store(self.tmp), Hub()
        self.httpd = serve(self.store, self.hub, "127.0.0.1", 0, KEY)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        shutil.rmtree(self.tmp)

    def req(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method,
                                   headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except HTTPError as e:
            return e.code, json.loads(e.read())

    def test_codebook_round_trip_with_version_check(self):
        status, cb = self.req("GET", "/api/codebook")
        self.assertEqual(status, 200)
        v = cb["version"]
        cb["stations"][0]["name"] = "Renamed"
        self.assertEqual(self.req("PUT", "/api/codebook", cb)[0], 401)
        status, saved = self.req("PUT", "/api/codebook", cb, {"X-API-Key": KEY, "If-Match": str(v)})
        self.assertEqual((status, saved["version"]), (200, v + 1))
        self.assertEqual(self.req("PUT", "/api/codebook", cb, {"X-API-Key": KEY, "If-Match": str(v)})[0], 409)
        self.assertEqual(self.req("GET", "/api/codebook")[1]["stations"][0]["name"], "Renamed")

    def test_invalid_codebook_is_rejected(self):
        _, cb = self.req("GET", "/api/codebook")
        cb["turnoutCodes"].append(dict(cb["turnoutCodes"][0]))
        status, body = self.req("PUT", "/api/codebook", cb, {"X-API-Key": KEY})
        self.assertEqual(status, 400)
        self.assertIn("listed twice", body["error"])

    def test_posted_calls_reach_stream_and_history(self):
        q = self.hub.subscribe()
        status, body = self.req("POST", "/api/calls", {"code": "182821", "kind": "station"}, {"X-API-Key": KEY})
        self.assertEqual(status, 201)
        msg = q.get(timeout=2).decode()
        self.assertIn("event: call", msg)
        self.assertIn("182821", msg)
        self.assertEqual(self.req("GET", "/api/calls?limit=5")[1]["calls"][-1]["code"], "182821")

    def test_stream_endpoint_sends_events(self):
        resp = urllib.request.urlopen(self.base + "/api/stream", timeout=5)
        self.assertEqual(resp.headers["Content-Type"], "text/event-stream")
        self.assertEqual(resp.readline(), b"retry: 3000\n")
        self.req("POST", "/api/calls", {"code": "D95D1-F1A0C2", "kind": "appliance-msg"}, {"X-API-Key": KEY})
        lines = [resp.readline() for _ in range(3)]
        self.assertIn(b"event: call\n", lines)
        resp.close()


if __name__ == "__main__":
    unittest.main()
