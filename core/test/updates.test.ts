import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkForUpdate, isNewer, REGISTRY_LATEST, updateNotice } from "@tomewise/core";

const NOW = new Date("2026-11-25T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function registry(version: string | Error) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(String(url));
    if (version instanceof Error) throw version;
    return new Response(JSON.stringify({ name: "tomewise", version }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function cacheFile(contents?: unknown) {
  const file = join(await mkdtemp(join(tmpdir(), "tomewise-update-")), "update-check.json");
  if (contents !== undefined) await writeFile(file, JSON.stringify(contents));
  return file;
}

describe("isNewer", () => {
  it("compares major, minor and patch as numbers", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.2.0", "0.1.12")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.1.2", "0.1.2")).toBe(false);
    expect(isNewer("0.1.1", "0.1.2")).toBe(false);
  });

  it("never calls an unparseable version newer", () => {
    expect(isNewer("garbage", "0.1.2")).toBe(false);
    expect(isNewer("0.2.0-beta.1", "0.1.2")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("asks the npm registry and reports a newer npm release", async () => {
    const { fetch, calls } = registry("0.2.0");

    const update = await checkForUpdate({ current: "0.1.2", env: {}, now: () => NOW, fetch });

    expect(calls).toEqual([REGISTRY_LATEST]);
    expect(update).toEqual({ current: "0.1.2", latest: "0.2.0", install: "npm", command: "npm install -g tomewise@latest", then: "restart the app" });
    expect(updateNotice(update!)).toBe("Tomewise 0.2.0 is out (you have 0.1.2). Update: npm install -g tomewise@latest, then restart the app.");
  });

  it("tells a Docker install to pull the new release's minor tag", async () => {
    const { fetch } = registry("0.2.1");

    const update = await checkForUpdate({ current: "0.1.2", env: { TOMEWISE_INSTALL: "docker" }, now: () => NOW, fetch });

    expect(update).toMatchObject({ install: "docker", command: "docker pull ghcr.io/isaacvarg/tomewise:0.2" });
    expect(updateNotice(update!)).toBe(
      "Tomewise 0.2.1 is out (you have 0.1.2). Update: docker pull ghcr.io/isaacvarg/tomewise:0.2, then recreate the container from ghcr.io/isaacvarg/tomewise:0.2.",
    );
  });

  it("reports nothing when already on the latest release", async () => {
    const { fetch } = registry("0.1.2");

    expect(await checkForUpdate({ current: "0.1.2", env: {}, now: () => NOW, fetch })).toBeNull();
  });

  it("uses a cached answer younger than a day without asking the registry", async () => {
    const { fetch, calls } = registry("0.3.0");
    const file = await cacheFile({ checkedAt: new Date(NOW.getTime() - HOUR).toISOString(), latest: "0.2.0" });

    const update = await checkForUpdate({ current: "0.1.2", env: {}, now: () => NOW, fetch, cacheFile: file });

    expect(calls).toEqual([]);
    expect(update?.latest).toBe("0.2.0");
  });

  it("asks again once the cache is a day old, and saves the answer", async () => {
    const { fetch, calls } = registry("0.3.0");
    const file = await cacheFile({ checkedAt: new Date(NOW.getTime() - 25 * HOUR).toISOString(), latest: "0.2.0" });

    const update = await checkForUpdate({ current: "0.1.2", env: {}, now: () => NOW, fetch, cacheFile: file });

    expect(calls).toHaveLength(1);
    expect(update?.latest).toBe("0.3.0");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ checkedAt: NOW.toISOString(), latest: "0.3.0" });
  });

  it("falls back to the cached answer when the registry can't be reached, and waits a day to retry", async () => {
    const { fetch } = registry(new Error("offline"));
    const file = await cacheFile({ checkedAt: new Date(NOW.getTime() - 25 * HOUR).toISOString(), latest: "0.2.0" });

    const update = await checkForUpdate({ current: "0.1.2", env: {}, now: () => NOW, fetch, cacheFile: file });

    expect(update?.latest).toBe("0.2.0");
    expect(JSON.parse(await readFile(file, "utf8")).checkedAt).toBe(NOW.toISOString());
  });

  it("reports nothing and stays quiet when the registry can't be reached and nothing is cached", async () => {
    const { fetch } = registry(new Error("offline"));

    expect(await checkForUpdate({ current: "0.1.2", env: {}, now: () => NOW, fetch, cacheFile: await cacheFile() })).toBeNull();
  });

  it.each([{ TOMEWISE_NO_UPDATE_CHECK: "1" }, { CI: "true" }])("skips the check with %o", async (env) => {
    const { fetch, calls } = registry("0.2.0");

    expect(await checkForUpdate({ current: "0.1.2", env, now: () => NOW, fetch })).toBeNull();
    expect(calls).toEqual([]);
  });
});
