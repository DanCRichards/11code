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
      call("182820", "station", 2),          // Birkenhead acknowledging (pattern)
      call("D8611-F1A0C2", "appliance-msg", 3),
      call("D8611B", "appliance", 4),        // final B = priority
      call("D8611-F1400C", "appliance-msg", 5),
      call("C072D2", "appliance", 6),
      call("182821", "station", 7, 0.2),
    ], ix);
    expect(evs.map((e) => e.type)).toEqual([
      "turnout", "station-ack", "status", "priority", "unknown-status", "unknown-code", "unreadable",
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
      call("182260", "station", t0 + 20_000),           // Grey Lynn acknowledges
      call("182851", "station", t0 + 60_000),           // Albany 851, far away: new job
      call("D95D1-F1A0C2", "appliance-msg", t0 + 90_000), // 205 responding
      call("182821", "station", t0 + 400_000),          // Birkenhead, much later: new job
    ], ix);
    const board = deriveBoard(evs, ix, Date.now(), new Set());
    const jobs = groupJobs(evs, ix, board, 180_000);
    expect(jobs.map((j) => j.stationIds)).toEqual([["birkenhead"], ["albany"], ["grey-lynn", "auckland-city"]]);
    expect(jobs[2].applianceIds).toEqual(["261", "205"]);
    expect(jobs[2].active).toBe(true);
    expect(jobs[2].turnouts).toHaveLength(2); // the acknowledgement isn't a turnout
  });
});

describe("turnout alarm", () => {
  it("matches chosen trucks and chosen stations, never an acknowledgement", async () => {
    const { alarmMatch } = await import("../ui/Alarm");
    const cfg = { stations: ["albany"], appliances: ["261"], sound: true, repeat: true };
    const [own, other, stationOfTruck, stationChosen, elsewhere] = interpretAll([
      call("182261", "station", 1), call("182205", "station", 2), call("182260", "station", 3),
      call("182851", "station", 4), call("182820", "station", 5),
    ], ix);
    expect(alarmMatch(own, cfg, ix)).toBe("Grey Lynn 261");
    expect(alarmMatch(other, cfg, ix)).toBeNull();
    expect(alarmMatch(stationOfTruck, cfg, ix)).toBeNull(); // 182260 is Grey Lynn acknowledging
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

  it("shows the exact K code heard, like K99, on the board", async () => {
    const { boardText } = await import("./derive");
    const evs = interpretAll([call("182821", "station", 1), call("D8611-F1A0C2", "appliance-msg", 2), call("D8611-F99A0C", "appliance-msg", 3)], ix);
    const ab = deriveBoard(evs, ix, 4, new Set()).appliances.get("821")!;
    expect(ab.state).toBe("at-incident");
    expect(boardText(ab)).toBe("K99 Well-involved fire");
    expect(evs[2].status?.arrival).toBe(true);
  });

  it("decodes every K code's tones back to the same code", async () => {
    const { decode, synth } = await import("../decoder/selcall");
    for (const st of cb.statusCodes) {
      const code = `D8611-${st.suffix}`;
      expect(decode(synth(code, 8000, 25), 8000)[0]?.code, st.kCode).toBe(code);
    }
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

describe("TV clusters", () => {
  it("makes tiles as big as fit, one cluster per station", async () => {
    const { fitClusters } = await import("../ui/MyBoard");
    const fits = (counts: number[], w: number, h: number) => {
      const f = fitClusters(counts, w, h, 14);
      const pad = f.th * 0.08, inner = f.th * 0.08, head = f.th * 0.3;
      let x = 0, line = 0, total = 0;
      counts.forEach((n, i) => {
        const cw = f.cols[i] * f.tw + (f.cols[i] - 1) * inner + 2 * pad;
        const ch = head + Math.ceil(n / f.cols[i]) * (f.th + inner) - inner + 2 * pad;
        if (x > 0 && x + cw > w) { total += line + 14; x = 0; line = 0; }
        x += cw + 14; line = Math.max(line, ch);
      });
      return { f, h: total + line };
    };
    const one = fits([1], 1920, 900);
    expect(one.h).toBeLessThanOrEqual(900);
    expect(one.f.th).toBeGreaterThan(500); // a single truck nearly fills the screen
    const many = fits([4, 2, 1, 1, 1, 2], 1920, 900);
    expect(many.h).toBeLessThanOrEqual(900);
    expect(many.f.th).toBeGreaterThan(150);
    expect(fitClusters([12], 1920, 900).cols[0]).toBeLessThan(12); // a big station wraps onto rows
  });
});
