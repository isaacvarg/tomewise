import { describe, expect, it } from "vitest";
import type { LearningEvent } from "@tomewise/core";
import { historyMessage } from "../src/history.ts";

let next = 0;

function event(subject: string, kind: LearningEvent["kind"], ts: string, extra: Partial<LearningEvent> = {}): LearningEvent {
  next++;
  return { id: `01KAJ00000000000000000${String(next).padStart(4, "0")}`, ts, subject, kind, schemaVersion: 2, data: {}, ...extra };
}

function session(subject: string, day: string, minutes: number, attempts: number): LearningEvent[] {
  const start = event(subject, "session.start", `${day}T10:00:00.000Z`);
  return [
    start,
    ...Array.from({ length: attempts }, (_, n) =>
      event(subject, "attempt", `${day}T10:01:${String(n % 60).padStart(2, "0")}.000Z`, {
        sessionId: start.id,
        outcome: n % 2 === 0 ? "correct" : "wrong",
        grade: 3,
      }),
    ),
    event(subject, "session.end", `${day}T10:${String(minutes).padStart(2, "0")}:00.000Z`, {
      sessionId: start.id,
      duration: minutes * 60_000,
    }),
  ];
}

describe("history commit messages", () => {
  it("sums one subject's sessions, minutes and attempts on one line", () => {
    const events = [...session("morse", "2026-11-21", 6, 40), ...session("morse", "2026-11-21", 7, 30), ...session("morse", "2026-11-21", 5, 26)];

    expect(historyMessage(events, "Europe/London")).toBe("chore(history): 2026-11-21 · morse 3 sessions, 18 min, 96 attempts");
  });

  it("says one session and one attempt in the singular", () => {
    expect(historyMessage(session("morse", "2026-11-21", 2, 1), "Europe/London")).toBe(
      "chore(history): 2026-11-21 · morse 1 session, 2 min, 1 attempt",
    );
  });

  it("puts each subject on its own body line when several had activity", () => {
    const events = [...session("spanish", "2026-11-21", 10, 12), ...session("morse", "2026-11-21", 18, 96), ...session("morse", "2026-11-21", 2, 4)];

    expect(historyMessage(events, "Europe/London")).toBe(
      [
        "chore(history): 2026-11-21 · 2 subjects, 3 sessions, 30 min, 112 attempts",
        "",
        "morse 2 sessions, 20 min, 100 attempts",
        "spanish 1 session, 10 min, 12 attempts",
      ].join("\n"),
    );
  });

  it("counts sessions that end in this commit, even if they started in an earlier one", () => {
    const [, ...rest] = session("morse", "2026-11-21", 12, 3);

    expect(historyMessage(rest, "Europe/London")).toBe("chore(history): 2026-11-21 · morse 1 session, 12 min, 3 attempts");
  });

  it("names a subject with only other events, such as a goal change", () => {
    const events = [event("morse", "goal.changed", "2026-11-21T09:00:00.000Z", { data: { from: [], to: [] } })];

    expect(historyMessage(events, "Europe/London")).toBe("chore(history): 2026-11-21 · morse 0 sessions, 0 min, 0 attempts");
  });

  it("dates the commit by the earliest event's day in the learning home's timezone", () => {
    const late = [event("morse", "session.start", "2026-11-21T23:30:00.000Z")];

    expect(historyMessage(late, "Europe/London")).toMatch(/^chore\(history\): 2026-11-21 · /);
    expect(historyMessage(late, "Asia/Tokyo")).toMatch(/^chore\(history\): 2026-11-22 · /);
  });

  it("dates a session that runs past midnight by the day it started", () => {
    const start = event("morse", "session.start", "2026-11-21T23:50:00.000Z");
    const end = event("morse", "session.end", "2026-11-22T00:10:00.000Z", { sessionId: start.id, duration: 20 * 60_000 });

    expect(historyMessage([start, end], "Europe/London")).toBe("chore(history): 2026-11-21 · morse 1 session, 20 min, 0 attempts");
  });

  it("totals the rounded minutes each subject line shows", () => {
    const events = [...session("morse", "2026-11-21", 2, 1), ...session("spanish", "2026-11-21", 2, 1)].map((e) =>
      e.kind === "session.end" ? { ...e, duration: 144_000 } : e,
    );

    expect(historyMessage(events, "Europe/London").split("\n")[0]).toBe(
      "chore(history): 2026-11-21 · 2 subjects, 2 sessions, 4 min, 2 attempts",
    );
  });
});
