import type { LearningEvent } from "./events.ts";
import type { ScoreDisplay } from "./schemas.ts";

export interface Score {
  right: number;
  total: number;
  score: number;
}

export interface ScoreResult extends Score {
  passMark: number;
  passed: boolean;
}

export interface ScoreView {
  display: ScoreDisplay;
  headline?: string;
  detail: string;
  passed?: boolean;
}

export function percent(right: number, total: number): number {
  return total === 0 ? 0 : Math.floor((right * 10_000) / total) / 100;
}

export function passes(score: number, passMark: number): boolean {
  return score >= passMark;
}

export function sessionScore(events: readonly LearningEvent[], sessionId: string, questions: readonly string[] = []): Score {
  const outcomes = new Map<string, LearningEvent["outcome"]>(questions.map((question) => [question, undefined]));
  for (const event of events) {
    if (event.kind !== "attempt" || event.sessionId !== sessionId) continue;
    const question = event.data?.question;
    outcomes.set(typeof question === "string" ? question : event.id, event.outcome);
  }
  const right = [...outcomes.values()].filter((outcome) => outcome === "correct").length;
  return { right, total: outcomes.size, score: percent(right, outcomes.size) };
}

export function judged(score: Score, passMark: number): ScoreResult {
  return { ...score, passMark, passed: passes(score.score, passMark) };
}

export function scoreView(result: ScoreResult, display: ScoreDisplay): ScoreView {
  switch (display) {
    case "number":
      return {
        display,
        headline: `${Math.floor(result.score)}%`,
        detail: `${result.right} of ${result.total} right · pass mark ${result.passMark}%`,
        passed: result.passed,
      };
    case "pass-fail":
      return {
        display,
        headline: result.passed ? "Passed" : "Not passed",
        detail: result.passed ? "You reached the pass mark." : "What you missed comes up for review sooner.",
        passed: result.passed,
      };
    case "hidden":
      return { display, detail: "Your score is saved for your agent." };
  }
}
