"""Codebook and call-log storage for the backend (JSON files on disk)."""

import json
import re
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

TONE = re.compile(r"^[0-9A-F]+$")


class ValidationError(ValueError):
    pass


class VersionConflict(Exception):
    pass


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_codebook(cb):
    """Light structural checks; returns a list of problems (empty if fine)."""
    problems = []
    for key in ("stations", "appliances", "turnoutCodes", "callTypes", "statusCodes"):
        if not isinstance(cb.get(key), list):
            problems.append(f"'{key}' must be a list")
    if problems:
        return problems
    station_ids = {s.get("id") for s in cb["stations"]}
    app_ids = {a.get("id") for a in cb["appliances"]}
    if len(station_ids) != len(cb["stations"]):
        problems.append("station ids must be unique")
    for s in cb["stations"]:
        if not s.get("id") or not s.get("name"):
            problems.append(f"station {s!r} needs an id and a name")
    seen_sel = {}
    for a in cb["appliances"]:
        if a.get("stationId") not in station_ids:
            problems.append(f"appliance {a.get('id')}: unknown station {a.get('stationId')}")
        sid = a.get("selcallId") or ""
        if sid and not (len(sid) == 5 and TONE.match(sid)):
            problems.append(f"appliance {a.get('id')}: selcall ID must be 5 tones (0-9, A-F)")
        if sid and sid in seen_sel:
            problems.append(f"selcall ID {sid} used by both {seen_sel[sid]} and {a.get('id')}")
        seen_sel[sid] = a.get("id")
    seen_codes = set()
    for c in cb["turnoutCodes"]:
        code = c.get("code", "")
        if not (len(code) == 6 and TONE.match(code)):
            problems.append(f"turnout code {code!r} must be 6 tones")
        if code in seen_codes:
            problems.append(f"turnout code {code} listed twice")
        seen_codes.add(code)
        if c.get("stationId") not in station_ids:
            problems.append(f"turnout code {code}: unknown station {c.get('stationId')}")
        if c.get("applianceId") and c["applianceId"] not in app_ids:
            problems.append(f"turnout code {code}: unknown appliance {c['applianceId']}")
    return problems


class Store:
    def __init__(self, data_dir, max_calls=2000):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.codebook_path = self.dir / "codebook.json"
        self.calls_path = self.dir / "calls.jsonl"
        self.codebook = json.loads(self.codebook_path.read_text())
        self.calls = deque(maxlen=max_calls)
        if self.calls_path.exists():
            for line in self.calls_path.read_text().splitlines()[-max_calls:]:
                try:
                    self.calls.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    def get_codebook(self):
        with self.lock:
            return self.codebook

    def put_codebook(self, cb, if_version=None):
        problems = validate_codebook(cb)
        if problems:
            raise ValidationError("; ".join(problems[:10]))
        with self.lock:
            current = self.codebook.get("version", 0)
            if if_version is not None and int(if_version) != current:
                raise VersionConflict(current)
            cb = dict(cb, version=current + 1, updatedAt=now_iso())
            tmp = self.codebook_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(cb, indent=1, ensure_ascii=False) + "\n")
            tmp.replace(self.codebook_path)
            self.codebook = cb
            return cb

    def add_call(self, code, kind, confidence, source="decoder", time=None, audio_time=None):
        call = {"id": uuid.uuid4().hex[:12], "time": time or now_iso(), "code": code,
                "kind": kind, "confidence": round(float(confidence), 3), "source": source}
        if audio_time is not None:
            call["audioTime"] = round(audio_time, 3)
        with self.lock:
            self.calls.append(call)
            with self.calls_path.open("a") as f:
                f.write(json.dumps(call) + "\n")
        return call

    def recent_calls(self, limit=200):
        with self.lock:
            return list(self.calls)[-limit:]
