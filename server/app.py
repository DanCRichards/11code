"""HTTP API for the turnout board (standard library only).

    GET  /api/health            status, versions, decoder state
    GET  /api/codebook          stations, appliances, codes
    PUT  /api/codebook          replace the codebook (X-API-Key; If-Match: <version>)
    GET  /api/calls?limit=200   recent decoded calls
    POST /api/calls             add calls from an external decoder (X-API-Key)
    GET  /api/stream            Server-Sent Events: "call" and "codebook"

Anything else is served from --static (the built web app), so a browser on
the same network can use the board without a separate web server.
"""

import json
import mimetypes
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .store import ValidationError, VersionConflict

VERSION = "1.0"


class Hub:
    """Fan-out of server-sent events to connected browsers."""

    def __init__(self):
        self.clients = set()
        self.lock = threading.Lock()

    def subscribe(self):
        q = queue.Queue(maxsize=500)
        with self.lock:
            self.clients.add(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.clients.discard(q)

    def publish(self, event, data):
        msg = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    self.clients.discard(q)  # a stalled client; it will reconnect


def make_handler(store, hub, api_key, static_dir=None, cors_origin="*", status=None):
    static_root = Path(static_dir).resolve() if static_dir else None
    status = status if status is not None else {}

    class Handler(BaseHTTPRequestHandler):
        server_version = f"SelCallBoard/{VERSION}"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            if not self.path.startswith("/api/stream"):
                super().log_message(fmt, *args)

        # -- helpers ---------------------------------------------------------
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", cors_origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, If-Match")
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "ETag")

        def _json(self, code, body, headers=None):
            data = json.dumps(body).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def _error(self, code, message):
            self._json(code, {"error": message})

        def _authorised(self):
            if self.headers.get("X-API-Key") == api_key:
                return True
            self._error(401, "Missing or wrong X-API-Key. The key is printed when the server starts.")
            return False

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 5_000_000:
                raise ValueError("body too large")
            return json.loads(self.rfile.read(n) or b"null")

        # -- routes ----------------------------------------------------------
        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/api/health":
                cb = store.get_codebook()
                return self._json(200, {"ok": True, "version": VERSION,
                                        "codebookVersion": cb.get("version"), **status})
            if url.path == "/api/codebook":
                cb = store.get_codebook()
                return self._json(200, cb, {"ETag": str(cb.get("version"))})
            if url.path == "/api/calls":
                q = parse_qs(url.query)
                limit = max(1, min(2000, int(q.get("limit", ["200"])[0])))
                return self._json(200, {"calls": store.recent_calls(limit)})
            if url.path == "/api/stream":
                return self._stream()
            if url.path.startswith("/api/"):
                return self._error(404, "No such endpoint")
            return self._static(url.path)

        def do_PUT(self):
            if urlparse(self.path).path != "/api/codebook":
                return self._error(404, "No such endpoint")
            if not self._authorised():
                return
            try:
                body = self._body()
                if not isinstance(body, dict):
                    raise ValidationError("Send the whole codebook as a JSON object")
                cb = store.put_codebook(body, self.headers.get("If-Match"))
            except VersionConflict as e:
                return self._error(409, f"The codebook changed on the server (now version {e.args[0]}). Reload and try again.")
            except (ValidationError, ValueError) as e:
                return self._error(400, str(e))
            hub.publish("codebook", {"version": cb["version"]})
            self._json(200, cb, {"ETag": str(cb["version"])})

        def do_POST(self):
            if urlparse(self.path).path != "/api/calls":
                return self._error(404, "No such endpoint")
            if not self._authorised():
                return
            try:
                body = self._body()
                items = body.get("calls", [body]) if isinstance(body, dict) else body
                added = []
                for c in items:
                    code = str(c["code"]).upper()
                    added.append(store.add_call(code, c.get("kind", ""), c.get("confidence", 1.0),
                                                c.get("source", "external"), c.get("time")))
            except (KeyError, TypeError, ValueError) as e:
                return self._error(400, f"Each call needs at least a 'code' ({e})")
            for call in added:
                hub.publish("call", call)
            self._json(201, {"calls": added})

        def _stream(self):
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            q = hub.subscribe()
            try:
                self.wfile.write(b"retry: 3000\n\n")
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=15)
                    except queue.Empty:
                        msg = b": keep-alive\n\n"
                    self.wfile.write(msg)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                hub.unsubscribe(q)
                self.close_connection = True

        def _static(self, path):
            if not static_root:
                return self._error(404, "No web app configured (start with --static web/dist)")
            target = (static_root / path.lstrip("/")).resolve()
            if static_root not in target.parents and target != static_root:
                return self._error(404, "Not found")
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                target = static_root / "index.html"
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


def serve(store, hub, host, port, api_key, static_dir=None, cors_origin="*", status=None):
    httpd = ThreadingHTTPServer((host, port), make_handler(store, hub, api_key, static_dir, cors_origin, status))
    httpd.daemon_threads = True
    return httpd
