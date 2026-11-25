import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliUpdateCheck, VERSION } from "../src/update.ts";

const newer = (() => {
  const [major, minor] = VERSION.split(".").map(Number);
  return `${major}.${minor! + 1}.0`;
})();

function registry() {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ version: newer }));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function home() {
  return { HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) };
}

describe("the CLI's update check", () => {
  it("checks after an interactive command and saves the answer for a day", async () => {
    const { fetch, calls } = registry();
    const env = await home();

    const first = await cliUpdateCheck({ args: ["due"], env, interactive: true, fetch });
    const second = await cliUpdateCheck({ args: ["stats"], env, interactive: true, fetch });

    expect(first).toMatchObject({ current: VERSION, latest: newer, install: "npm" });
    expect(second?.latest).toBe(newer);
    expect(calls).toHaveLength(1);
  });

  it.each([
    { why: "output isn't a terminal", args: ["due"], interactive: false, env: {} },
    { why: "the command is serve, which checks for the dashboard", args: ["serve"], interactive: true, env: {} },
    { why: "output is JSON", args: ["stats", "--json"], interactive: true, env: {} },
    { why: "run through npx", args: ["due"], interactive: true, env: { npm_command: "exec" } },
    { why: "there is no command", args: [], interactive: true, env: {} },
  ])("skips the check when $why", async ({ args, interactive, env }) => {
    const { fetch, calls } = registry();

    expect(cliUpdateCheck({ args, env: { ...(await home()), ...env }, interactive, fetch })).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
