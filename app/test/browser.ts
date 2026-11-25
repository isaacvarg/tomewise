import { cp } from "node:fs/promises";
import { afterAll, onTestFinished } from "vitest";
import type { Update } from "@tomewise/core";
import { type Browser, chromium, type Page } from "playwright";
import { tempDir } from "../../core/test/helpers.ts";
import { buildWidgets } from "../../widgets/scripts/build.ts";
import { buildSpa } from "../scripts/build.ts";
import { BUILT_IN } from "../src/tool-files.ts";
import { startTestApp } from "./harness.ts";

const FIXTURE = new URL("./fixtures/dashboard/", import.meta.url);
export const TODAY = new Date("2026-11-21T12:00:00Z");

export const WIDTHS = { phone: { width: 375, height: 812 }, desktop: { width: 1280, height: 900 } } as const;
export type Width = keyof typeof WIDTHS;

let built: Promise<{ spa: string; widgets: string }> | undefined;
let browser: Promise<Browser> | undefined;

function builtApp() {
  built ??= (async () => {
    const [spa, widgets] = await Promise.all([tempDir(), tempDir()]);
    await Promise.all([buildSpa(spa), buildWidgets(widgets)]);
    return { spa, widgets };
  })();
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

export interface DashboardOptions {
  prepare?: (root: string) => Promise<void>;
  width?: Width;
  built?: boolean;
  touch?: boolean;
  updates?: () => Promise<Update | null>;
}

export async function startDashboard({ prepare, width = "phone", built = true, touch = false, updates }: DashboardOptions = {}) {
  const { spa, widgets } = await builtApp();
  const app = await startTestApp(
    async (root) => {
      await cp(FIXTURE, root, { recursive: true });
      await prepare?.(root);
    },
    { widgets, themes: BUILT_IN.themes },
    { spa: built ? spa : undefined, clock: { now: () => TODAY, every: () => () => {} }, updates },
  );
  browser ??= launch();
  const session = await (await browser).newContext({ viewport: WIDTHS[width], reducedMotion: "reduce", ...(touch && { hasTouch: true, isMobile: true }) });
  onTestFinished(() => session.close());
  const page = await session.newPage();
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  async function open(path: string): Promise<Page> {
    await page.goto(`${app.url}${path}`);
    return page;
  }

  return { app, page, pageErrors, open };
}
