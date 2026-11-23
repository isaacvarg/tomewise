import { execFile } from "node:child_process";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { SYNC_CHECK_MS } from "../web/home/sync.tsx";
import { startDashboard, TODAY, type Width } from "./browser.ts";

const run = promisify(execFile);
const AT = TODAY.toISOString();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
  return stdout.trim();
}

async function withGit(root: string, remote: string, { unpushed = false } = {}) {
  const path = join(root, "tomewise.json");
  const config = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...config, git: { remote: "origin", push: true } }, null, 2));
  await git(remote, "init", "--bare", "--quiet", "--initial-branch=main");
  await git(root, "init", "--quiet", "--initial-branch=main");
  await git(root, "add", "-A");
  await git(root, "commit", "--quiet", "-m", "chore: start");
  await git(root, "remote", "add", "origin", remote);
  await git(root, "push", "--quiet", "origin", "main");
  if (unpushed) await git(root, "commit", "--quiet", "--allow-empty", "-m", "chore(history): 2026-11-20 · morse-code 1 session");
}

interface HomeOptions {
  width?: Width;
  unpushed?: boolean;
  gitOn?: boolean;
  beforeOpen?: (page: Page) => Promise<unknown>;
}

async function openHome({ width = "phone", unpushed = false, gitOn = true, beforeOpen }: HomeOptions = {}) {
  const remote = await mkdtemp(join(tmpdir(), "tomewise-remote-"));
  const dashboard = await startDashboard({ width, prepare: gitOn ? (root) => withGit(root, remote, { unpushed }) : undefined });
  await beforeOpen?.(dashboard.page);
  const page = await dashboard.open("/");
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  await page.locator(".tome-sync[data-sync]").waitFor();
  return { ...dashboard, page, remote };
}

const sync = (page: Page) => page.locator(".tome-sync");
const times = (page: Page) => page.locator(".tome-sync time").evaluateAll((els) => els.map((el) => el.getAttribute("datetime")));
const syncNow = (page: Page) => page.locator(".tome-sync-now");

describe("the dashboard's sync indicator", () => {
  it("shows a sync that hasn't run yet, with Sync now", async () => {
    const { page, pageErrors } = await openHome();

    expect(await sync(page).getAttribute("data-sync")).toBe("ok");
    expect(await sync(page).locator(".tome-meta").innerText()).toBe("Pulled never · Pushed never");
    expect(await syncNow(page).innerText()).toBe("Sync now");
    expect(await page.locator(".tome-sync .tome-notice").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it("syncs on Sync now and shows the last pull and push", async () => {
    const { page, remote, app } = await openHome({ unpushed: true });

    await syncNow(page).click();

    await expect.poll(() => times(page)).toEqual([AT, AT]);
    expect(await sync(page).locator(".tome-meta").innerText()).toMatch(/^Pulled \S.* · Pushed \S.*$/);
    expect(await sync(page).getAttribute("data-sync")).toBe("ok");
    expect(await git(remote, "rev-parse", "main")).toBe(await git(app.root, "rev-parse", "HEAD"));
    expect(await syncNow(page).isEnabled()).toBe(true);
  });

  it("flags a stopped sync with the error, and keeps flagging it after a reload", async () => {
    const { page, remote, open } = await openHome();
    await rename(remote, `${remote}-away`);

    await syncNow(page).click();

    await expect.poll(() => sync(page).getAttribute("data-sync")).toBe("stopped");
    const notice = sync(page).locator('.tome-notice[role="alert"]');
    expect(await notice.innerText()).toMatch(/^Sync stopped: git pull .+/);
    expect(await sync(page).locator(".tome-meta").innerText()).toBe("Pulled never · Pushed never");

    await open("/");
    await page.locator('.tome-sync[data-sync="stopped"]').waitFor();
    expect(await sync(page).locator(".tome-notice").innerText()).toMatch(/^Sync stopped: git pull .+/);
  });

  it("clears the flag once Sync now works again", async () => {
    const { page, remote } = await openHome();
    await rename(remote, `${remote}-away`);
    await syncNow(page).click();
    await page.locator('.tome-sync[data-sync="stopped"]').waitFor();

    await rename(`${remote}-away`, remote);
    await syncNow(page).click();

    await expect.poll(() => sync(page).getAttribute("data-sync")).toBe("ok");
    expect(await page.locator(".tome-sync .tome-notice").count()).toBe(0);
    expect(await times(page)).toEqual([AT]);
  });

  it("flags a sync that stopped in the background without a reload", async () => {
    const { page, remote, app } = await openHome({ beforeOpen: (page) => page.clock.install() });
    await rename(remote, `${remote}-away`);
    expect((await app.send("POST", "/api/sync")).body).toMatchObject({ stopped: true });

    await page.clock.runFor(SYNC_CHECK_MS);

    await expect.poll(() => sync(page).getAttribute("data-sync")).toBe("stopped");
    expect(await sync(page).locator(".tome-notice").innerText()).toMatch(/^Sync stopped: git pull .+/);
  });

  it("says when Sync now can't reach the app, and lets the learner try again", async () => {
    const { page } = await openHome();
    await page.route("**/api/sync", (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()));

    await syncNow(page).click();

    await expect.poll(() => page.locator('.tome-sync .tome-notice[role="alert"]').count()).toBe(1);
    expect(await sync(page).getAttribute("data-sync")).toBe("ok");
    expect(await syncNow(page).isEnabled()).toBe(true);
    expect(await syncNow(page).innerText()).toBe("Sync now");
  });

  it("says sync is off, with nothing to press, when git is off", async () => {
    const { page } = await openHome({ gitOn: false });

    expect(await sync(page).getAttribute("data-sync")).toBe("off");
    expect(await sync(page).innerText()).toBe("Git sync is off");
    expect(await syncNow(page).count()).toBe(0);
  });

  it.each(["phone", "desktop"] as const)("sits last on the page at %s width, using only contract classes", async (width) => {
    const { page } = await openHome({ width });

    const bottoms = (selector: string) =>
      page.locator(selector).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().bottom)));
    const [indicator] = await bottoms(".tome-app > .tome-sync");
    expect(indicator).toBeGreaterThanOrEqual(Math.max(...(await bottoms(".tome-app > :not(.tome-sync)"))));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const used = await page
      .locator(".tome-sync, .tome-sync *")
      .evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList]))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
  });
});
