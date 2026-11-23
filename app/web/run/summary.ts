import { judged, percent, scoreView } from "@tomewise/core/score";
import type { AssessmentSettings, Subject } from "../api.ts";
import type { Answered, DrillDone } from "./tome.ts";

type Item = Subject["items"][number];

export interface SubjectRun extends DrillDone {
  subject: Subject;
}

export interface LookAgain {
  key: string;
  label: string;
  why: string;
  times: number;
  lesson?: { href: string; title: string };
}

export interface SubjectScore {
  id: string;
  name: string;
  right: number;
  answered: number;
}

export interface Summary {
  right: number;
  answered: number;
  planned: number;
  score: string;
  time: string | undefined;
  timeUp: boolean;
  lookAgain: LookAgain[];
  subjects: SubjectScore[];
}

function labelOf(item: Item | undefined, ref: string): string {
  if (!item) return ref.replace(/^item:/, "");
  switch (item.type) {
    case "flashcard":
      return item.front;
    case "routine":
      return item.name;
    default:
      return item.answer;
  }
}

function whyOf(item: Item | undefined, result: Answered): string {
  if (result.outcome === "skipped") return "No answer";
  return item?.type === "flashcard" || item?.type === "routine" ? "Again" : "Wrong";
}

export function lessonTitle(id: string): string {
  const numbered = /^(\d+)-(.+)$/.exec(id);
  return numbered ? `Lesson ${Number(numbered[1])}: ${numbered[2]!.replaceAll("-", " ")}` : id.replaceAll("-", " ");
}

export function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export function summarize(runs: readonly SubjectRun[]): Summary {
  const results = runs.flatMap((run) => run.results);
  const right = results.filter((result) => result.outcome === "correct").length;
  const sessions = runs.flatMap((run) => (run.session ? [run.session.duration] : []));
  const lookAgain = new Map<string, LookAgain>();
  for (const run of runs) {
    const items = new Map(run.subject.items.map((item) => [`item:${item.id}`, item]));
    for (const result of run.results) {
      if (result.grade !== 1) continue;
      const key = `${run.subject.id} ${result.ref}`;
      const seen = lookAgain.get(key);
      if (seen) {
        seen.times++;
        continue;
      }
      const item = items.get(result.ref);
      const lesson = item?.unlockedBy;
      lookAgain.set(key, {
        key,
        label: labelOf(item, result.ref),
        why: whyOf(item, result),
        times: 1,
        ...(lesson && {
          lesson: {
            href: `/s/${encodeURIComponent(run.subject.id)}/lessons/${encodeURIComponent(lesson)}.html`,
            title: lessonTitle(lesson),
          },
        }),
      });
    }
  }
  return {
    right,
    answered: results.length,
    planned: runs.reduce((total, run) => total + run.planned, 0),
    score: results.length ? `${Math.round((right / results.length) * 100)}%` : "–",
    time: sessions.length ? clock(sessions.reduce((total, ms) => total + ms, 0)) : undefined,
    timeUp: runs.some((run) => run.timeUp),
    lookAgain: [...lookAgain.values()],
    subjects: runs.map((run) => ({
      id: run.subject.id,
      name: run.subject.name,
      right: run.results.filter((result) => result.outcome === "correct").length,
      answered: run.results.length,
    })),
  };
}

export interface QuizAnswer {
  key: string;
  prompt: string;
  given: string;
  answer: string;
  outcome: Answered["outcome"];
}

export interface QuizSummary {
  timeUp: boolean;
  score: string | undefined;
  scoreSub: string;
  answers: QuizAnswer[];
  marked: boolean;
}

const RATINGS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" } as const;

function quizAnswer(item: Item | undefined, result: Answered, index: number): QuizAnswer {
  const key = `${index} ${result.ref}`;
  const given = result.outcome === "skipped" ? "No answer" : item?.type === "flashcard" ? RATINGS[result.grade] : (result.given ?? "");
  if (!item) return { key, prompt: labelOf(item, result.ref), given, answer: "", outcome: result.outcome };
  switch (item.type) {
    case "flashcard":
      return { key, prompt: item.front, given, answer: item.back, outcome: result.outcome };
    case "routine":
      return { key, prompt: item.name, given, answer: "", outcome: result.outcome };
    default:
      return { key, prompt: item.prompt ?? "Listen", given, answer: item.answer, outcome: result.outcome };
  }
}

export function summarizeQuiz(run: SubjectRun, { scoreDisplay, passMark }: Pick<AssessmentSettings, "scoreDisplay" | "passMark">): QuizSummary {
  const items = new Map(run.subject.items.map((item) => [`item:${item.id}`, item]));
  const right = run.results.filter((result) => result.outcome === "correct").length;
  const answers = run.results.map((result, index) => quizAnswer(items.get(result.ref), result, index));
  const view = scoreView(judged({ right, total: run.planned, score: percent(right, run.planned) }, passMark), scoreDisplay);
  return { timeUp: run.timeUp, score: view.headline, scoreSub: view.detail, answers, marked: scoreDisplay !== "hidden" };
}
