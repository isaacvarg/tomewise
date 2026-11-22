import { cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, onTestFinished } from "vitest";
import { type Browser, type BrowserContextOptions, chromium, type Page } from "playwright";
import { tempDir } from "../../core/test/helpers.ts";
import { startTestApp } from "../../app/test/harness.ts";
import { BUILT_IN } from "../../app/src/tool-files.ts";
import { buildWidgets } from "../scripts/build.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

let built: Promise<string> | undefined;
let browser: Promise<Browser> | undefined;

function builtWidgets(): Promise<string> {
  built ??= tempDir().then(async (out) => {
    await buildWidgets(out);
    return out;
  });
  return built;
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chromium" });
  } catch (error) {
    throw new Error(
      "Browser tests need Chromium. Run `pnpm exec playwright install chromium`, " +
        "or on NixOS set PLAYWRIGHT_BROWSERS_PATH to `nix build --print-out-paths nixpkgs#playwright-driver.browsers-chromium` " +
        "(keep the playwright package at the same version as nixpkgs' playwright-driver).\n" +
        (error as Error).message,
    );
  }
}

afterAll(async () => {
  const running = browser;
  browser = undefined;
  await (await running)?.close();
});

export type LearningEvent = Record<string, any>;

export interface WidgetAppOptions {
  prepare?: (root: string) => Promise<void>;
  context?: BrowserContextOptions;
}

export async function startWidgetApp({ prepare, context }: WidgetAppOptions = {}) {
  const app = await startTestApp(
    async (root) => {
      await cp(FIXTURES, root, { recursive: true });
      await prepare?.(root);
    },
    { widgets: await builtWidgets(), themes: BUILT_IN.themes },
  );
  browser ??= launch();
  const session = await (await browser).newContext(context);
  onTestFinished(() => session.close());
  const page = await session.newPage();
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  async function events(subject: string): Promise<LearningEvent[]> {
    const dir = join(app.root, "subjects", subject, "events");
    let names: string[];
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const all: LearningEvent[] = [];
    for (const name of names) {
      const text = await readFile(join(dir, name), "utf8");
      all.push(...text.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
    }
    return all;
  }

  async function eventsUntil(subject: string, done: (events: LearningEvent[]) => boolean): Promise<LearningEvent[]> {
    let latest: LearningEvent[] = [];
    await expect
      .poll(async () => done((latest = await events(subject))), { timeout: 5000, interval: 50 })
      .toBe(true);
    return latest;
  }

  async function open(path: string): Promise<Page> {
    await page.goto(`${app.url}${path}`);
    return page;
  }

  return { app, page, pageErrors, open, events, eventsUntil };
}
