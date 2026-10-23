import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { synth } from "../decoder/selcall";
import { load, save, useStore } from "../store";
import { Seg, useBoard } from "./common";

interface Question {
  code: string; // e.g. 182821
  stationId: string;
  applianceId: string;
  options: string[]; // station ids, one of them right
}

type Scope = "all" | "mine";
const CHOICES = { easy: 4, hard: 8 } as const;
type Level = keyof typeof CHOICES;

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

let ctx: AudioContext | undefined;
/** Play a code's tones cleanly. Called from a tap, so the browser allows audio. */
function playTones(code: string) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const x = synth(code, ctx.sampleRate, 40);
    const buf = ctx.createBuffer(1, x.length, ctx.sampleRate);
    buf.getChannelData(0).set(x.map((v) => v * 0.5));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  } catch { /* no audio here */ }
}

/** Hear a station's turnout tones and guess which station it is. */
export function QuizView() {
  const { ix, codebook } = useBoard();
  const settings = useStore((s) => s.settings);
  const [scope, setScope] = useState<Scope>(() => load<Scope>("tb.quizScope") ?? "all");
  const [level, setLevel] = useState<Level>(() => load<Level>("tb.quizLevel") ?? "easy");
  const [q, setQ] = useState<Question | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, asked: 0, streak: 0 });
  const [best, setBest] = useState(() => load<number>("tb.quizBest") ?? 0);
  const last = useRef<string>();

  // Your stations: anything on a board, starred, or set to alarm.
  const mine = useMemo(() => new Set([
    ...settings.myBoard.boards.flatMap((b) => b.appliances.map((id) => ix.appliance.get(id)?.stationId)),
    ...settings.watched, ...settings.alarm.stations,
    ...settings.alarm.appliances.map((id) => ix.appliance.get(id)?.stationId),
  ].filter((x): x is string => !!x)), [settings, ix]);

  // Each truck's own turnout code (182 + callsign) is a question.
  const pool = useMemo(() => codebook.turnoutCodes.filter((t) => t.applianceId && ix.station.has(t.stationId) && ix.appliance.has(t.applianceId)
    && (scope === "all" || mine.has(t.stationId))), [codebook, ix, scope, mine]);
  const allStations = useMemo(() => [...new Set(codebook.turnoutCodes.filter((t) => t.applianceId).map((t) => t.stationId))].filter((s) => ix.station.has(s)), [codebook, ix]);

  const next = useCallback(() => {
    if (!pool.length) { setQ(null); return; }
    let t = pick(pool);
    for (let i = 0; i < 5 && t.code === last.current && pool.length > 1; i++) t = pick(pool);
    last.current = t.code;
    const others = shuffle(allStations.filter((s) => s !== t.stationId)).slice(0, CHOICES[level] - 1);
    const question = { code: t.code, stationId: t.stationId, applianceId: t.applianceId!, options: shuffle([t.stationId, ...others]) };
    setQ(question);
    setAnswer(null);
    playTones(question.code);
  }, [pool, allStations, level]);

  const choose = useCallback((sid: string) => {
    if (!q || answer) return;
    setAnswer(sid);
    const right = sid === q.stationId;
    setScore((s) => {
      const streak = right ? s.streak + 1 : 0;
      if (streak > best) { setBest(streak); save("tb.quizBest", streak); }
      return { right: s.right + (right ? 1 : 0), asked: s.asked + 1, streak };
    });
  }, [q, answer, best]);

  useEffect(() => { // keys: 1-8 answer, space hears it again, Enter for the next one
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === " " && q) { e.preventDefault(); playTones(q.code); }
      else if (e.key === "Enter") { e.preventDefault(); if (!q || answer) next(); }
      else if (q && !answer && /^[1-8]$/.test(e.key)) { const sid = q.options[Number(e.key) - 1]; if (sid) choose(sid); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, answer, next, choose]);

  const setScopeTo = (v: Scope) => { setScope(v); save("tb.quizScope", v); setQ(null); setAnswer(null); };
  const setLevelTo = (v: Level) => { setLevel(v); save("tb.quizLevel", v); setQ(null); setAnswer(null); };
  const right = answer && q ? answer === q.stationId : null;
  const name = (sid: string) => ix.station.get(sid)?.name ?? sid;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="page-title">Tone quiz</h1>
        <div className="row">
          <Seg label="Stations" value={scope} onChange={setScopeTo} options={[["all", "All stations"], ["mine", "My stations"]]} />
          <Seg label="Choices" value={level} onChange={setLevelTo} options={[["easy", "4 choices"], ["hard", "8 choices"]]} />
        </div>
      </div>

      <section className="panel quiz">
        <div className="quiz-score" aria-live="polite">
          <span><b>{score.right}</b>/{score.asked} right</span>
          <span>Streak <b>{score.streak}</b></span>
          <span>Best <b>{best}</b></span>
        </div>

        {!q ? (
          <div className="quiz-start">
            <p>You'll hear a truck's turnout tones. Pick the station it belongs to.</p>
            {scope === "mine" && !pool.length
              ? <p className="note">You haven't picked any stations yet. Add trucks to a board, star a station, or switch to All stations.</p>
              : <button className="btn primary big" onClick={next}>Start: play the first tone</button>}
            <p className="note">Plays through your speakers even when the radio is muted. Keys: 1–{CHOICES[level]} to answer, Space to hear it again, Enter for the next one.</p>
          </div>
        ) : (
          <>
            <div className="quiz-play">
              <button className="quiz-hear" onClick={() => playTones(q.code)} aria-label="Hear the tones again">
                <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
                <span>Hear it again</span>
              </button>
              <p className="quiz-prompt">{answer ? (right ? "Correct" : "Not quite") : "Which station is this?"}</p>
            </div>
            <div className={`quiz-options n${q.options.length}`}>
              {q.options.map((sid, i) => {
                const state = !answer ? "" : sid === q.stationId ? " right" : sid === answer ? " wrong" : " dim";
                return (
                  <button key={sid} className={`quiz-opt${state}`} onClick={() => choose(sid)} disabled={!!answer}>
                    <kbd>{i + 1}</kbd>{name(sid)}
                  </button>
                );
              })}
            </div>
            {answer && (
              <div className={`quiz-reveal${right ? " right" : " wrong"}`}>
                <div>
                  <b>{name(q.stationId)} {ix.appliance.get(q.applianceId)?.callsign}</b>
                  <span className="mono">{q.code.slice(0, 3)} · {q.code.slice(3)}</span>
                </div>
                <p className="note">Turnout tones are 182, then the truck's callsign. The first two digits of the callsign are the station.</p>
                <button className="btn primary" onClick={next} autoFocus>Next tone</button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
