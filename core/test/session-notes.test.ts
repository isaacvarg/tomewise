import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLearningHome, rebuildVault, VaultDisabledError, writeSessionNote } from "../src/index.ts";
import { copyExample, snapshot } from "./helpers.ts";

async function morse(vault?: Record<string, unknown>): Promise<string> {
  const root = await copyExample("morse");
  const file = join(root, "tomewise.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), vault }));
  return root;
}

const DRILL = "sessions/morse-code/2026-11-05-01M6NAP4308X87ZBZYKA7BNNWX.md";

describe("writeSessionNote", () => {
  it("writes just that session's note, the same one a rebuild writes", async () => {
    const root = await morse({});
    const home = await loadLearningHome(root);

    expect(await writeSessionNote(home, "morse-code", "01M6NAP4308X87ZBZYKA7BNNWX")).toEqual({ written: [DRILL], leftAlone: [] });
    const live = await snapshot(join(root, "sessions"));
    expect(Object.keys(live)).toEqual(["morse-code/2026-11-05-01M6NAP4308X87ZBZYKA7BNNWX.md"]);

    await rebuildVault(home);
    expect((await snapshot(join(root, "sessions")))[`morse-code/2026-11-05-01M6NAP4308X87ZBZYKA7BNNWX.md`]).toBe(
      live["morse-code/2026-11-05-01M6NAP4308X87ZBZYKA7BNNWX.md"],
    );
  });

  it("refuses with vault mode off", async () => {
    const home = await loadLearningHome(await morse());

    await expect(writeSessionNote(home, "morse-code", "01M6NAP4308X87ZBZYKA7BNNWX")).rejects.toThrow(VaultDisabledError);
  });
});
