import { describe, expect, it } from "vitest";
import bundled from "../../../data/codebook.json";
import { deriveBoard, suggestForStationCode } from "./derive";
import { buildIndex, interpretAll } from "./interpret";
import type { Call, Codebook } from "./types";

const cb = bundled as unknown as Codebook;
const ix = buildIndex(cb);
let n = 0;
const call = (code: string, kind: Call["kind"], t: number, confidence = 1): Call =>
  ({ id: String(n++), time: t, code, kind, confidence, source: "test" });

describe("interpretation", () => {
  it("reads turnouts, statuses, priority calls and unknowns", () => {
    const evs = interpretAll([
      call("182821", "station", 1),          // Birkenhead 821, from the list
      call("182820", "station", 2),          // Birkenhead station (pattern)
      call("D8611-F1A0C2", "appliance-msg", 3),
      call("D8611B", "appliance", 4),        // final B = priority
      call("D8611-F1400C", "appliance-msg", 5),
      call("C072D2", "appliance", 6),
      call("182821", "station", 7, 0.2),
    ], ix);
    expect(evs.map((e) => e.type)).toEqual([
      "turnout", "station-turnout", "status", "priority", "unknown-status", "unknown-code", "unreadable",
    ]);
    expect(evs[0].title).toBe("Birkenhead 821");
    expect(evs[2].state).toBe("responding");
  });

  it("folds the log into appliance and station state", () => {
    const now = Date.now();
    const board = deriveBoard(interpretAll([
      call("182821", "station", now - 5000),
      call("D8611-F1A0C2", "appliance-msg", now - 4000),
      call("D8611-F2A0C2", "appliance-msg", now - 3000),
      call("C072D2", "appliance", now - 2000),
      call("C072D2", "appliance", now - 1000),
    ], ix), ix, now, new Set());
    expect(board.appliances.get("821")?.state).toBe("at-incident");
    expect(board.stations.get("birkenhead")?.turnoutsToday).toBe(1);
    expect(board.inbox).toHaveLength(1);
    expect(board.inbox[0]).toMatchObject({ what: "unit", code: "C072D", count: 2 });
  });

  it("suggests owners for unknown station codes from the 182 pattern", () => {
    expect(suggestForStationCode("182207", ix)).toMatchObject({ stationId: "auckland-city", applianceId: "207" });
    expect(suggestForStationCode("182610", ix)).toMatchObject({ stationId: "balmoral", applianceId: null });
    expect(suggestForStationCode("186661", ix)).toBeUndefined();
  });
});
