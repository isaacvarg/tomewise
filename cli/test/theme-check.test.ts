import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyExample, tempDir } from "../../core/test/helpers.ts";
import { BUILT_IN } from "../../app/src/tool-files.ts";
import { buildWidgets } from "../../widgets/scripts/build.ts";
import { run, USAGE } from "../src/main.ts";

const FIXTURES = new URL("./fixtures/themes/", import.meta.url);

let widgets: Promise<string> | undefined;
function builtWidgets(): Promise<string> {
  widgets ??= tempDir().then(async (out) => {
    await buildWidgets(out);
    return out;
  });
  return widgets;
}

async function withFixture(home: string, fixture: string, as = fixture) {
  await cp(new URL(`${fixture}/`, FIXTURES), join(home, "themes", as), { recursive: true });
}

async function check(name: string, prepare?: (home: string) => Promise<void>) {
  const home = await copyExample("morse");
  await prepare?.(home);
  const out = await tempDir();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(["theme", "check", name, "--out", out], {
    cwd: home,
    env: { HOME: await tempDir() },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    tool: { widgets: await builtWidgets(), themes: BUILT_IN.themes },
  });
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), out, home };
}

const SHOTS = ["375-light", "375-dark", "768-light", "768-dark", "1280-light", "1280-dark"];

describe("tome theme check", { timeout: 120_000 }, () => {
  it.each(["paper", "meadow"])("passes the built-in %s theme and writes its screenshots", async (theme) => {
    const { code, stdout, stderr, out } = await check(theme);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(`${theme} passes`);
    expect(stdout).toContain(`Screenshots: ${out}`);
    expect((await readdir(out)).sort()).toEqual(SHOTS.map((shot) => `${theme}-${shot}.png`).sort());
  });

  it("fails a theme whose text is too faint, naming the element, width and mode", async () => {
    const { code, stdout } = await check("low-contrast", (home) => withFixture(home, "low-contrast"));

    expect(code).toBe(1);
    expect(stdout).toMatch(/^✗ 375, 768, 1280px light: contrast \d\.\d\d:1, needs 4\.5:1 · p\.tome-hint "Tap to start/m);
    expect(stdout).not.toMatch(/dark: contrast/);
    expect(stdout).toMatch(/problems? in low-contrast/);
  });

  it("fails a theme that overflows the phone width, naming the element and width", async () => {
    const { code, stdout } = await check("overflowing", (home) => withFixture(home, "overflowing"));

    expect(code).toBe(1);
    expect(stdout).toMatch(/^✗ 375px light: overflow · div\.tome-stage in <tome-choice> · ready is \d+px wide, wider than the 375px viewport$/m);
  });

  it("fails a theme that leaves out required tokens", async () => {
    const { code, stdout } = await check("gappy", async (home) => {
      await withFixture(home, "low-contrast", "gappy");
      const tokens = join(home, "themes/gappy/tokens.css");
      await writeFile(tokens, (await readFile(tokens, "utf8")).replaceAll(/--t-cell-radius: [^;]+;/g, ""));
    });

    expect(code).toBe(1);
    expect(stdout).toContain("✗ light: missing token --t-cell-radius");
  });

  it("refuses a theme that doesn't exist", async () => {
    const { code, stderr } = await check("nope");

    expect(code).toBe(1);
    expect(stderr).toBe('No theme "nope" in themes/ or the built-in themes.');
  });

  it("is in the usage", () => {
    expect(USAGE).toContain("tome theme check <name> [--out <dir>]");
  });
});
