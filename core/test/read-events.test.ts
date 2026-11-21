import { describe, expect, it } from "vitest";
import { InvalidLearningHomeError, loadLearningHome, readEvents, SubjectNotFoundError } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

function event(id: string, ts: string) {
  return { id, ts, subject: "morse-code", kind: "goal.changed", schemaVersion: 1 };
}

function jsonl(...events: unknown[]): string {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

const base = {
  "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
  "subjects/morse-code/subject.json": { name: "Morse code" },
};

describe("reading events", () => {
  it("merges the main and per-machine files for a date range, in time order", async () => {
    const root = await buildHome({
      ...base,
      "subjects/morse-code/events/2026-10.jsonl": jsonl(
        event("01KAJ0000000000000000000A1", "2026-10-30T09:00:00.000Z"),
        event("01KAJ0000000000000000000A2", "2026-10-31T09:00:00.000Z"),
      ),
      "subjects/morse-code/events/2026-11.jsonl": jsonl(
        event("01KAJ0000000000000000000B1", "2026-11-02T09:00:00.000Z"),
        event("01KAJ0000000000000000000B4", "2026-11-20T09:00:00.000Z"),
      ),
      "subjects/morse-code/events/2026-11.laptop.jsonl": jsonl(
        event("01KAJ0000000000000000000B2", "2026-11-05T09:00:00.000Z"),
        event("01KAJ0000000000000000000B5", "2026-11-30T23:59:59.999Z"),
      ),
      "subjects/morse-code/events/2026-11.desktop.jsonl": jsonl(
        event("01KAJ0000000000000000000B3", "2026-11-05T10:00:00.000Z"),
      ),
      "subjects/morse-code/events/2026-12.jsonl": jsonl(event("01KAJ0000000000000000000C1", "2026-12-01T00:00:00.000Z")),
    });

    const events = await readEvents(await loadLearningHome(root), "morse-code", {
      from: "2026-10-31T00:00:00.000Z",
      to: new Date("2026-12-01T00:00:00.000Z"),
    });

    expect(events.map((e) => e.id)).toEqual([
      "01KAJ0000000000000000000A2",
      "01KAJ0000000000000000000B1",
      "01KAJ0000000000000000000B2",
      "01KAJ0000000000000000000B3",
      "01KAJ0000000000000000000B4",
      "01KAJ0000000000000000000B5",
    ]);
  });

  it("reads every event when no range is given, and none when there is no events folder", async () => {
    const withEvents = await buildHome({
      ...base,
      "subjects/morse-code/events/2026-11.jsonl": jsonl(event("01KAJ0000000000000000000B1", "2026-11-02T09:00:00.000Z")),
    });

    expect(await readEvents(await loadLearningHome(withEvents), "morse-code")).toHaveLength(1);
    expect(await readEvents(await loadLearningHome(await buildHome(base)), "morse-code")).toEqual([]);
  });

  it("ignores files in events that aren't event files", async () => {
    const root = await buildHome({
      ...base,
      "subjects/morse-code/events/.gitkeep": "",
      "subjects/morse-code/events/README.md": "# Events",
      "subjects/morse-code/events/2026-11.jsonl": jsonl(event("01KAJ0000000000000000000B1", "2026-11-02T09:00:00.000Z")),
    });

    expect(await readEvents(await loadLearningHome(root), "morse-code")).toHaveLength(1);
  });

  it("refuses to read past a broken line, naming its file and line", async () => {
    const root = await buildHome({
      ...base,
      "subjects/morse-code/events/2026-11.jsonl": `${jsonl(event("01KAJ0000000000000000000B1", "2026-11-02T09:00:00.000Z"))}{ oops\n`,
    });

    const error = await readEvents(await loadLearningHome(root), "morse-code").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidLearningHomeError);
    expect((error as InvalidLearningHomeError).issues).toEqual([
      { file: "subjects/morse-code/events/2026-11.jsonl", line: 2, path: "", message: expect.stringMatching(/^Invalid JSON/) },
    ]);
  });

  it("refuses an unknown subject", async () => {
    const home = await loadLearningHome(await buildHome(base));

    await expect(readEvents(home, "yoga")).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});
