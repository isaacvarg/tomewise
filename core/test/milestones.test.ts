import { describe, expect, it } from "vitest";
import { loadLearningHome, loadSubject, milestoneStatusesOf, readEvents } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SUBJECT = "morse-code";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `01KAJ${String(counter).padStart(21, "0")}`;
}

function marked(ts: string, milestone: string, status: string) {
  return { id: nextId(), ts, subject: SUBJECT, kind: "milestone.status", ref: `milestone:${milestone}`, schemaVersion: 1, data: { status } };
}

function jsonl(...events: unknown[]): string {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

async function statuses(events: Record<string, string>) {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "UTC" },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code" },
    [`subjects/${SUBJECT}/curriculum.json`]: {
      units: [
        {
          title: "Koch letters",
          milestones: [
            { id: "first-letters", title: "Copy K, M and R", status: "current" },
            { id: "s", title: "Copy S", status: "upcoming" },
          ],
        },
      ],
    },
    ...Object.fromEntries(Object.entries(events).map(([file, text]) => [`subjects/${SUBJECT}/events/${file}.jsonl`, text])),
  });
  const home = await loadLearningHome(root);
  return milestoneStatusesOf(await loadSubject(home, SUBJECT), await readEvents(home, SUBJECT));
}

describe("milestone status", () => {
  it("is the status in curriculum.json while no event marks it", async () => {
    expect(await statuses({})).toEqual({ "first-letters": "current", s: "upcoming" });
  });

  it("is the status an event marks it with", async () => {
    expect(await statuses({ "2026-11": jsonl(marked("2026-11-03T18:00:00.000Z", "first-letters", "done")) })).toEqual({
      "first-letters": "done",
      s: "upcoming",
    });
  });

  it("is the status from the latest event, whatever file or line it is in", async () => {
    expect(
      await statuses({
        "2026-10": jsonl(marked("2026-10-30T09:00:00.000Z", "s", "skipped")),
        "2026-11": jsonl(
          marked("2026-11-05T09:00:00.000Z", "first-letters", "done"),
          marked("2026-11-02T09:00:00.000Z", "first-letters", "changed"),
          marked("2026-11-01T09:00:00.000Z", "s", "current"),
        ),
        "2026-11.laptop": jsonl(marked("2026-11-04T09:00:00.000Z", "first-letters", "skipped")),
      }),
    ).toEqual({ "first-letters": "done", s: "current" });
  });
});
