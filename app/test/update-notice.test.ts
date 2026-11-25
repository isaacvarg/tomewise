import { describe, expect, it } from "vitest";
import { appClasses, updateFor } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";
import { startTestApp } from "./harness.ts";

describe("GET /api/update", () => {
  it("reports no update when the server has no update check", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/update");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ update: null });
  });

  it("reports what the update check found", async () => {
    const update = updateFor("0.1.2", "0.2.0", "npm");
    const app = await startTestApp(undefined, undefined, { updates: async () => update });

    await expect.poll(async () => (await app.get("/api/update")).body).toEqual({ update });
  });

  it("keeps serving when the update check fails", async () => {
    const app = await startTestApp(undefined, undefined, { updates: async () => Promise.reject(new Error("offline")) });

    expect((await app.get("/api/update")).body).toEqual({ update: null });
  });
});

async function openHome(updates?: () => Promise<ReturnType<typeof updateFor> | null>, width: Width = "phone") {
  const dashboard = await startDashboard({ updates, width });
  const page = await dashboard.open("/");
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  return { ...dashboard, page };
}

describe("the dashboard's update notice", () => {
  it("shows nothing when there is no newer release", async () => {
    const { page, pageErrors } = await openHome(async () => null);

    await page.waitForLoadState("networkidle");
    expect(await page.locator(".tome-update").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it("tells an npm install to upgrade with npm and restart", async () => {
    const { page, pageErrors } = await openHome(async () => updateFor("0.1.2", "0.2.0", "npm"));

    const notice = page.locator(".tome-update");
    await notice.waitFor();
    expect(await notice.getAttribute("data-install")).toBe("npm");
    expect(await notice.innerText()).toBe("Tomewise 0.2.0 is out. You have 0.1.2.\n\nnpm install -g tomewise@latest, then restart the app.");
    expect(pageErrors).toEqual([]);
  });

  it("tells a Docker install to pull the image and recreate the container", async () => {
    const { page } = await openHome(async () => updateFor("0.1.2", "0.2.1", "docker"));

    const notice = page.locator(".tome-update");
    await notice.waitFor();
    expect(await notice.getAttribute("data-install")).toBe("docker");
    expect(await page.locator(".tome-update-command").innerText()).toBe("docker pull ghcr.io/isaacvarg/tomewise:0.2");
    expect(await notice.innerText()).toContain("then recreate the container from ghcr.io/isaacvarg/tomewise:0.2.");
  });

  it.each<Width>(["phone", "desktop"])("sits under the header and uses only contract classes (%s)", async (width) => {
    const { page } = await openHome(async () => updateFor("0.1.2", "0.2.0", "npm"), width);
    await page.locator(".tome-update").waitFor();

    const top = (selector: string) => page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const bottom = (selector: string) => page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
    expect(await top(".tome-update")).toBeGreaterThanOrEqual(await bottom(".tome-header"));
    expect(await bottom(".tome-update")).toBeLessThanOrEqual(await top(".tome-activity"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const used = await page.locator(".tome-update, .tome-update *").evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList]))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
  });
});
