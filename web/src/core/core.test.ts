import { describe, expect, it, vi } from "vitest";
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

describe("jobs", () => {
  it("groups nearby turnouts and attaches responding appliances", async () => {
    const { groupJobs } = await import("./incidents");
    const t0 = Date.now() - 600_000;
    const evs = interpretAll([
      call("182261", "station", t0),                    // Grey Lynn 261
      call("182205", "station", t0 + 40_000),           // Auckland City 205, 2.1 km away
      call("182850", "station", t0 + 60_000),           // Albany station, far away: new job
      call("D95D1-F1A0C2", "appliance-msg", t0 + 90_000), // 205 responding
      call("182821", "station", t0 + 400_000),          // Birkenhead, much later: new job
    ], ix);
    const board = deriveBoard(evs, ix, Date.now(), new Set());
    const jobs = groupJobs(evs, ix, board, 180_000);
    expect(jobs.map((j) => j.stationIds)).toEqual([["birkenhead"], ["albany"], ["grey-lynn", "auckland-city"]]);
    expect(jobs[2].applianceIds).toEqual(["261", "205"]);
    expect(jobs[2].active).toBe(true);
  });
});

describe("turnout alarm", () => {
  it("matches chosen trucks, chosen stations, and station calls where a chosen truck lives", async () => {
    const { alarmMatch } = await import("../ui/Alarm");
    const cfg = { stations: ["albany"], appliances: ["261"], sound: true, repeat: true };
    const [own, other, stationOfTruck, stationChosen, elsewhere] = interpretAll([
      call("182261", "station", 1), call("182205", "station", 2), call("182260", "station", 3),
      call("182851", "station", 4), call("182820", "station", 5),
    ], ix);
    expect(alarmMatch(own, cfg, ix)).toBe("Grey Lynn 261");
    expect(alarmMatch(other, cfg, ix)).toBeNull();
    expect(alarmMatch(stationOfTruck, cfg, ix)).toBe("Grey Lynn station");
    expect(alarmMatch(stationChosen, cfg, ix)).toBe("Albany 851");
    expect(alarmMatch(elsewhere, cfg, ix)).toBeNull();
  });
});

describe("K codes", () => {
  it("labels truck statuses with their K code", async () => {
    const { stateText } = await import("./derive");
    expect(stateText("responding")).toBe("K1 Responding");
    expect(stateText("at-incident")).toBe("K2 At incident");
    expect(stateText("out-of-area")).toBe("K3 Out of area");
    expect(stateText("available-radio")).toBe("K4 Available (radio)");
    expect(stateText("on-station")).toBe("K7 On station");
    expect(stateText("turned-out")).toBe("Turned out");
  });
});

describe("priority alarm and un-mute", () => {
  it("matches any truck, or only chosen trucks and stations", async () => {
    const { priorityMatch } = await import("../ui/Alarm");
    const [glPrio, acPrio, glTurnout] = interpretAll([
      call("D72F1B", "appliance", 1), // Grey Lynn 261 priority
      call("D95D1B", "appliance", 2), // Auckland City 205 priority
      call("182261", "station", 3),
    ], ix);
    expect(priorityMatch(glPrio, { scope: "off", stations: [], appliances: [] })).toBeNull();
    expect(priorityMatch(acPrio, { scope: "any", stations: [], appliances: [] })).toBe("Auckland City 205");
    const chosen = { scope: "chosen" as const, stations: [], appliances: ["261"] };
    expect(priorityMatch(glPrio, chosen)).toBe("Grey Lynn 261");
    expect(priorityMatch(acPrio, chosen)).toBeNull();
    expect(priorityMatch(acPrio, { scope: "chosen", stations: ["auckland-city"], appliances: [] })).toBe("Auckland City 205");
    expect(priorityMatch(glTurnout, { scope: "any", stations: [], appliances: [] })).toBeNull();
  });

  it("un-mutes radio audio for the set time when an alert fires, then mutes again", async () => {
    vi.useFakeTimers();
    const { store } = await import("../store");
    store.settings({ muted: true });
    store.alertSettings({ unmuteSeconds: 45 });
    expect(store.audible()).toBe(false);
    store.alertUnmute();
    expect(store.audible()).toBe(true);
    vi.advanceTimersByTime(44_000);
    expect(store.audible()).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(store.audible()).toBe(false);
    expect(store.get().unmutedUntil).toBeUndefined();
    store.settings({ muted: false });
    vi.useRealTimers();
  });
});

describe("TV grid", () => {
  it("picks the column count that makes tiles biggest", async () => {
    const { fitGrid } = await import("../ui/MyBoard");
    expect(fitGrid(6, 1920, 900, 12)).toEqual({ cols: 3, rows: 2 });
    expect(fitGrid(12, 1920, 900, 12)).toEqual({ cols: 4, rows: 3 });
    expect(fitGrid(1, 1920, 900)).toEqual({ cols: 1, rows: 1 });
  });
});
