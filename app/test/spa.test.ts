import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { loadLearningHome } from "@tomewise/core";
import { copyExample, tempDir, writeFiles } from "../../core/test/helpers.ts";
import { startServer } from "../src/index.ts";

const BODY = "<title>Tomewise</title><div id=root></div>";
const INDEX = `<!doctype html>${BODY}`;

async function startWithSpa(spa: string | undefined) {
  const home = await loadLearningHome(await copyExample("morse"));
  const server = await startServer(home, { host: "127.0.0.1", port: 0, spa });
  onTestFinished(() => server.close());
  return (path: string, init?: RequestInit) => fetch(`${server.url}${path}`, init);
}

async function builtSpa(): Promise<string> {
  const parent = await tempDir();
  await writeFiles(parent, {
    "secret.txt": "outside the SPA",
    "spa/index.html": INDEX,
    "spa/assets/app.js": "console.log('app')",
  });
  return join(parent, "spa");
}

describe("dashboard SPA", () => {
  it("serves index.html at /", async () => {
    const get = await startWithSpa(await builtSpa());

    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await response.text()).toContain(BODY);
  });

  it("serves built assets with their content type", async () => {
    const get = await startWithSpa(await builtSpa());

    const response = await get("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/);
    expect(await response.text()).toBe("console.log('app')");
  });

  it("serves index.html for client-side routes", async () => {
    const get = await startWithSpa(await builtSpa());

    for (const path of ["/settings", "/s/morse-code", "/run/due"]) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toContain(BODY);
    }
  });

  it("serves index.html for every subject home tab, and lesson pages and assets from the subject", async () => {
    const get = await startWithSpa(await builtSpa());

    for (const tab of ["curriculum", "drills", "reference", "stats"]) {
      const response = await get(`/s/morse-code/${tab}`);
      expect(response.status, tab).toBe(200);
      expect(await response.text(), tab).toContain(BODY);
    }
    const lesson = await get("/s/morse-code/lessons/0001-k-and-m.html");
    expect(lesson.status).toBe(200);
    expect(await lesson.text()).toContain('name="tome-page-kind" content="lesson"');
    const audio = await get("/s/morse-code/assets/audio/k.wav");
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toMatch(/audio/);
  });

  it("answers 404 for a missing file rather than index.html", async () => {
    const get = await startWithSpa(await builtSpa());

    expect((await get("/assets/missing.js")).status).toBe(404);
    expect((await get("/s/morse-code/lessons/missing.html")).status).toBe(404);
    expect((await get("/s/morse-code/reference/missing.html")).status).toBe(404);
  });

  it("leaves API routes alone", async () => {
    const get = await startWithSpa(await builtSpa());

    const unknown = await get("/api/nothing-here");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).not.toContain(BODY);

    const posted = await get("/api/events", { method: "POST", body: "[]" });
    expect(posted.status).toBe(400);
    expect(await posted.json()).toEqual({ issues: [{ file: "request", path: "", message: "No events" }] });
  });

  it("doesn't escape the SPA folder", async () => {
    const get = await startWithSpa(await builtSpa());

    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/assets/%2e%2e/%2e%2e/secret.txt"]) {
      const response = await get(path);
      expect(await response.text(), path).not.toMatch(/outside the SPA/);
    }
  });

  it("serves nothing at / when no SPA is built", async () => {
    const get = await startWithSpa(await tempDir());

    expect((await get("/")).status).toBe(404);
    expect((await get("/settings")).status).toBe(404);
  });

  it("serves nothing at / without an SPA folder", async () => {
    const get = await startWithSpa(undefined);

    expect((await get("/")).status).toBe(404);
  });

  it("serves nothing, quietly, when the SPA folder doesn't exist", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => error.mockRestore());
    const get = await startWithSpa(join(await tempDir(), "missing"));

    expect((await get("/")).status).toBe(404);
    expect((await get("/settings")).status).toBe(404);
    expect(error).not.toHaveBeenCalled();
  });
});
