import { describe, expect, it } from "vitest";
import type { LearningEvent } from "@tomewise/core";
import { judged, passes, percent, scoreView, sessionScore } from "../src/score.ts";

const SESSION = "01KAJ0000000000000000000S1";
const OTHER = "01KAJ0000000000000000000S2";

let counter = 0;
function answered(question: string | undefined, outcome: LearningEvent["outcome"], sessionId = SESSION, ref = "item:letter-k"): LearningEvent {
  counter += 1;
  return {
    id: `01KAJ${String(counter).padStart(21, "0")}`,
    ts: "2026-11-03T18:01:00.000Z",
    subject: "morse-code",
    kind: "attempt",
    ref,
    sessionId,
    outcome,
    grade: outcome === "correct" ? 3 : 1,
    schemaVersion: 1,
    data: question === undefined ? {} : { question },
  };
}

describe("scoring a session", () => {
  it("scores each question once, however many items it tests", () => {
    const events = [
      answered("q1", "correct", SESSION, "item:letter-k"),
      answered("q1", "correct", SESSION, "item:letter-r"),
      answered("q2", "wrong"),
      answered("q3", "correct"),
      answered("q4", "skipped"),
    ];

    expect(sessionScore(events, SESSION)).toEqual({ right: 2, total: 4, score: 50 });
  });

  it("counts only this session's attempts", () => {
    const events = [answered("q1", "correct"), answered("q1", "wrong", OTHER), answered("q2", "wrong", OTHER)];

    expect(sessionScore(events, SESSION)).toEqual({ right: 1, total: 1, score: 100 });
  });

  it("counts a question on the page that was never answered as missed", () => {
    expect(sessionScore([answered("q1", "correct")], SESSION, ["q1", "q2", "q3", "q4"])).toEqual({ right: 1, total: 4, score: 25 });
  });

  it("takes a question's latest answer", () => {
    expect(sessionScore([answered("q1", "wrong"), answered("q1", "correct")], SESSION)).toEqual({ right: 1, total: 1, score: 100 });
  });

  it("counts each attempt without a question on its own", () => {
    expect(sessionScore([answered(undefined, "correct"), answered(undefined, "wrong")], SESSION)).toEqual({ right: 1, total: 2, score: 50 });
  });

  it("scores nothing answered as 0", () => {
    expect(sessionScore([], SESSION)).toEqual({ right: 0, total: 0, score: 0 });
  });

  it("keeps two decimals, rounding down so a score never rises to a pass mark it missed", () => {
    expect(percent(2, 3)).toBe(66.66);
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(7, 10)).toBe(70);
  });
});

describe("the pass rule", () => {
  it("passes a score at or above the pass mark", () => {
    expect(passes(70, 70)).toBe(true);
    expect(passes(85.5, 70)).toBe(true);
    expect(passes(69.99, 70)).toBe(false);
    expect(passes(0, 0)).toBe(true);
  });

  it("judges a score against a pass mark", () => {
    expect(judged({ right: 7, total: 10, score: 70 }, 70)).toEqual({ right: 7, total: 10, score: 70, passMark: 70, passed: true });
    expect(judged({ right: 2, total: 3, score: 66.66 }, 66.67)).toMatchObject({ passed: false });
  });
});

describe("showing a score", () => {
  const pass = judged({ right: 8, total: 10, score: 80 }, 70);
  const fail = judged({ right: 2, total: 3, score: 66.66 }, 70);

  it("shows the number", () => {
    expect(scoreView(pass, "number")).toEqual({ display: "number", headline: "80%", detail: "8 of 10 right · pass mark 70%", passed: true });
    expect(scoreView(fail, "number")).toMatchObject({ headline: "66%", passed: false });
  });

  it("shows pass or fail only", () => {
    expect(scoreView(pass, "pass-fail")).toEqual({ display: "pass-fail", headline: "Passed", detail: "You reached the pass mark.", passed: true });
    expect(scoreView(fail, "pass-fail")).toEqual({
      display: "pass-fail",
      headline: "Not passed",
      detail: "What you missed comes up for review sooner.",
      passed: false,
    });
  });

  it("shows no score and no verdict when hidden", () => {
    expect(scoreView(pass, "hidden")).toEqual({ display: "hidden", detail: "Your score is saved for your agent." });
    expect(scoreView(fail, "hidden")).toEqual(scoreView(pass, "hidden"));
  });
});
