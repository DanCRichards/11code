"""Build the starting codebook (stations, appliances, codes) from Store/*.lst.

    python tools/make_codebook.py  ->  data/codebook.json

Turnout codes in Store/stations.lst follow "182" + appliance callsign
(182821 = Birkenhead 821), and codes ending in 0 look like whole-station
calls (182860 "KUMEU STATION"). Codes from the list are marked
source="list"; codes filled in from that pattern are source="pattern" and
unverified. Station positions are approximate.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# id, name, station number, lat, lon, appliance callsigns
STATIONS = [
    ("auckland-city", "Auckland City", "20", -36.8563, 174.7598, ["201", "205", "206", "207"]),
    ("remuera", "Remuera", "21", -36.8790, 174.7985, ["211"]),
    ("mt-wellington", "Mt Wellington", "23", -36.9050, 174.8400, ["237"]),
    ("st-heliers", "St Heliers", "24", -36.8545, 174.8585, ["241"]),
    ("parnell", "Parnell", "25", -36.8580, 174.7800, ["251", "255"]),
    ("grey-lynn", "Grey Lynn", "26", -36.8608, 174.7383, ["261"]),
    ("ellerslie", "Ellerslie", "27", -36.8990, 174.8080, ["271", "274"]),
    ("onehunga", "Onehunga", "", -36.9233, 174.7845, []),
    ("howick", "Howick", "32", -36.8985, 174.9290, ["321", "322"]),
    ("papatoetoe", "Papatoetoe", "34", -36.9790, 174.8500, ["341", "347"]),
    ("mangere", "Mangere", "35", -36.9690, 174.7980, ["351"]),
    ("manurewa", "Manurewa", "", -37.0230, 174.8960, []),
    ("papakura", "Papakura", "38", -37.0640, 174.9440, ["381"]),
    ("avondale", "Avondale", "60", -36.8968, 174.6925, ["607"]),
    ("balmoral", "Balmoral", "61", -36.8890, 174.7470, ["611"]),
    ("mt-roskill", "Mt Roskill", "62", -36.9105, 174.7370, ["621"]),
    ("glen-eden", "Glen Eden", "64", -36.9110, 174.6510, ["641"]),
    ("henderson", "Henderson", "65", -36.8800, 174.6300, ["651", "657"]),
    ("west-harbour", "West Harbour", "67", -36.8180, 174.6170, ["671", "672"]),
    ("titirangi", "Titirangi", "69", -36.9370, 174.6560, ["691", "692"]),
    ("takapuna", "Takapuna", "80", -36.7880, 174.7700, ["801", "807"]),
    ("devonport", "Devonport", "81", -36.8290, 174.7960, ["811", "812"]),
    ("birkenhead", "Birkenhead", "82", -36.8085, 174.7270, ["821", "822"]),
    ("east-coast-bays", "East Coast Bays", "83", -36.7470, 174.7400, ["831", "832"]),
    ("greenhithe", "Greenhithe", "84", -36.7730, 174.6890, ["841"]),
    ("albany", "Albany", "85", -36.7300, 174.6990, ["851"]),
    ("kumeu", "Kumeu", "86", -36.7770, 174.5580, ["861", "862", "867"]),
    ("muriwai", "Muriwai", "87", -36.8320, 174.4290, ["871"]),
    ("shelly-beach", "Shelly Beach", "88", -36.5970, 174.3530, ["881"]),
    ("helensville", "Helensville", "89", -36.6790, 174.4500, ["891"]),
    ("silverdale", "Silverdale", "90", -36.6170, 174.6770, ["901", "907"]),
    ("manly", "Manly", "91", -36.6390, 174.7510, ["911"]),
]

# Selcall IDs already identified in Store/appliances.lst.
KNOWN_IDS = {"205": "D95D1", "206": "D7811", "207": "D62E1", "261": "D72F1", "807": "D582C",
             "821": "D8611", "831": "DB884", "832": "DB531", "611": "C5861"}

SYMBOLS = "0123456789ABCDF"


def placeholder_id(callsign, used):
    """Deterministic, unique placeholder 5-tone ID for appliances without one."""
    n = int(callsign) * 7919 + 17
    while True:
        tail = ""
        m = n
        for _ in range(4):
            tail += SYMBOLS[m % len(SYMBOLS)]
            m //= len(SYMBOLS)
        cand = "C" + tail
        if cand not in used:
            used.add(cand)
            return cand
        n += 1


def main():
    by_number = {s[2]: s for s in STATIONS if s[2]}
    stations, appliances, codes = [], [], {}
    used_ids = set(KNOWN_IDS.values())
    for sid, name, num, lat, lon, calls in STATIONS:
        stations.append({"id": sid, "name": name, "number": num, "lat": lat, "lon": lon})
        for c in calls:
            known = c in KNOWN_IDS
            appliances.append({
                "id": c, "callsign": c, "stationId": sid, "type": "",
                "selcallId": KNOWN_IDS[c] if known else placeholder_id(c, used_ids),
                "selcallVerified": known,
            })

    app_by_call = {a["callsign"]: a for a in appliances}
    for line in (ROOT / "Store/stations.lst").read_text().splitlines():
        m = re.match(r"\s*(\d{6}),", line)
        if not m:
            continue
        code = m.group(1)
        if not code.startswith("182"):
            continue  # odd prefixes (186412, 126212) are left for the unknown-code inbox
        tail = code[3:]
        if tail.endswith("0") and tail[:2] in by_number:
            codes[code] = {"code": code, "stationId": by_number[tail[:2]][0], "applianceId": None,
                           "source": "list"}
        elif tail in app_by_call:
            codes[code] = {"code": code, "stationId": app_by_call[tail]["stationId"],
                           "applianceId": tail, "source": "list"}
    # Fill the gaps from the pattern: an appliance code and a whole-station code.
    for a in appliances:
        c = "182" + a["callsign"]
        codes.setdefault(c, {"code": c, "stationId": a["stationId"], "applianceId": a["id"],
                             "source": "pattern"})
    for sid, name, num, *_ in STATIONS:
        if num:
            c = "182" + num + "0"
            codes.setdefault(c, {"code": c, "stationId": sid, "applianceId": None, "source": "pattern"})

    codebook = {
        "schema": 1,
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "region": "Auckland",
        "stations": stations,
        "appliances": appliances,
        "turnoutCodes": sorted(codes.values(), key=lambda c: c["code"]),
        # Final tone of a short appliance call (e.g. C072D2). Meanings are a
        # guess carried over from SepacDecoder.py and are unverified.
        "callTypes": [
            {"final": "4", "label": "Turnout acknowledgement", "priority": False, "verified": False},
            {"final": "C", "label": "Routine call", "priority": False, "verified": False},
            {"final": "B", "label": "Priority call", "priority": True, "verified": False},
        ],
        # Long appliance messages: HEADER-<suffix>. Real suffix meanings are
        # unknown; the K-code entries are the demo's own encoding.
        "statusCodes": [
            {"suffix": "F1A0C2", "kCode": "K1", "label": "Responding", "state": "responding", "demo": True},
            {"suffix": "F2A0C2", "kCode": "K2", "label": "At incident", "state": "at-incident", "demo": True},
            {"suffix": "F3A0C2", "kCode": "K3", "label": "Out of area", "state": "out-of-area", "demo": True},
            {"suffix": "F4A0C2", "kCode": "K4", "label": "Available on radio", "state": "available-radio", "demo": True},
            {"suffix": "F7A0C2", "kCode": "K7", "label": "On station", "state": "on-station", "demo": True},
        ],
    }
    out = ROOT / "data/codebook.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(codebook, indent=1, ensure_ascii=False) + "\n")
    src = sum(1 for c in codes.values() if c["source"] == "list")
    print(f"{len(stations)} stations, {len(appliances)} appliances, "
          f"{len(codes)} turnout codes ({src} from list) -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
