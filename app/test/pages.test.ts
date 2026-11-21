import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../core/test/helpers.ts";
import { startTestApp } from "./harness.ts";

const SUBJECT = "subjects/morse-code";

async function withPages(root: string) {
  for (const [folder, file] of [
    ["quizzes", "week-1.html"],
    ["exams", "milestone-1.html"],
    ["reference", "alphabet.html"],
  ] as const) {
    await mkdir(join(root, SUBJECT, folder), { recursive: true });
    await writeFile(join(root, SUBJECT, folder, file), `<!doctype html><title>${folder}</title>`);
  }
}

describe("learning-home pages", () => {
  it("serves a lesson as written, as HTML", async () => {
    const app = await startTestApp();
    const written = await readFile(join(app.root, SUBJECT, "lessons/0001-k-and-m.html"));

    const response = await app.get("/s/morse-code/lessons/0001-k-and-m.html");

    expect(response.status).toBe(200);
    expect(response.type).toBe("text/html; charset=utf-8");
    expect(response.body.equals(written)).toBe(true);
  });

  it.each([
    ["quizzes", "week-1.html"],
    ["exams", "milestone-1.html"],
    ["reference", "alphabet.html"],
  ])("serves %s from the subject's folder", async (folder, file) => {
    const app = await startTestApp(withPages);

    const response = await app.get(`/s/morse-code/${folder}/${file}`);

    expect(response.status).toBe(200);
    expect(response.type).toBe("text/html; charset=utf-8");
    expect(response.body.toString()).toBe(`<!doctype html><title>${folder}</title>`);
  });

  it("serves nested assets with their content type", async () => {
    const app = await startTestApp();
    const written = await readFile(join(app.root, SUBJECT, "assets/audio/k.wav"));

    const response = await app.get("/s/morse-code/assets/audio/k.wav");

    expect(response.status).toBe(200);
    expect(response.type).toBe("audio/wav");
    expect(response.body.equals(written)).toBe(true);
  });

  it("serves unknown extensions as bytes", async () => {
    const app = await startTestApp(async (root) => {
      await writeFile(join(root, SUBJECT, "assets/notes.morse"), "-.- --");
    });

    const response = await app.get("/s/morse-code/assets/notes.morse");

    expect(response.status).toBe(200);
    expect(response.type).toBe("application/octet-stream");
  });

  it.each([
    ["a missing file", "/s/morse-code/lessons/9999-nope.html"],
    ["a missing asset", "/s/morse-code/assets/audio/z.wav"],
    ["an unknown subject", "/s/klingon/lessons/0001-k-and-m.html"],
    ["a folder", "/s/morse-code/assets/audio"],
    ["a folder that isn't a page folder", "/s/morse-code/items/0001-k-and-m.json"],
    ["a page folder the subject doesn't have", "/s/morse-code/quizzes/week-1.html"],
  ])("gives 404 for %s", async (_, path) => {
    const app = await startTestApp();

    expect((await app.get(path)).status).toBe(404);
  });
});

describe("path escape", () => {
  it.each([
    ["dot-dot segments", "/s/morse-code/lessons/../../../tomewise.json"],
    ["dot-dot in assets", "/s/morse-code/assets/../subject.json"],
    ["encoded dots", "/s/morse-code/lessons/%2e%2e/subject.json"],
    ["encoded slashes", "/s/morse-code/lessons/..%2F..%2F..%2Ftomewise.json"],
    ["encoded slashes in assets", "/s/morse-code/assets/audio%2F..%2F..%2Fsubject.json"],
    ["encoded backslashes", "/s/morse-code/lessons/..%5C..%5Csubject.json"],
    ["double-encoded dots", "/s/morse-code/lessons/%252e%252e%252Fsubject.json"],
    ["an absolute path", "/s/morse-code/assets/%2Fetc%2Fpasswd"],
    ["an empty segment", "/s/morse-code/assets//etc/passwd"],
    ["a dot-dot subject", "/s/..%2Fsubjects%2Fmorse-code/lessons/0001-k-and-m.html"],
    ["a NUL byte", "/s/morse-code/lessons/0001-k-and-m.html%00.png"],
  ])("refuses %s", async (_, path) => {
    const app = await startTestApp();

    const response = await app.get(path);

    expect(response.status).toBe(404);
    expect(response.body.toString()).not.toContain("formatVersion");
    expect(response.body.toString()).not.toContain("root:");
  });

  it("refuses symlinks pointing outside the learning home", async () => {
    const outside = await tempDir();
    await writeFile(join(outside, "secret.html"), "secret");
    const app = await startTestApp(async (root) => {
      await symlink(join(outside, "secret.html"), join(root, SUBJECT, "lessons/secret.html"));
      await symlink(outside, join(root, SUBJECT, "assets/elsewhere"));
    });

    for (const path of ["/s/morse-code/lessons/secret.html", "/s/morse-code/assets/elsewhere/secret.html"]) {
      const response = await app.get(path);
      expect(response.status).toBe(404);
      expect(response.body.toString()).not.toContain("secret");
    }
  });

  it("refuses symlinks pointing out of the folder within the learning home", async () => {
    const app = await startTestApp(async (root) => {
      await symlink(join(root, "tomewise.json"), join(root, SUBJECT, "lessons/config.html"));
      await symlink(join(root, SUBJECT, "events"), join(root, SUBJECT, "assets/events"));
    });

    expect((await app.get("/s/morse-code/lessons/config.html")).status).toBe(404);
    expect((await app.get("/s/morse-code/assets/events/2026-11.jsonl")).status).toBe(404);
  });

  it("follows symlinks that stay inside the folder", async () => {
    const app = await startTestApp(async (root) => {
      await symlink(join(root, SUBJECT, "assets/audio/k.wav"), join(root, SUBJECT, "assets/k.wav"));
    });

    const response = await app.get("/s/morse-code/assets/k.wav");

    expect(response.status).toBe(200);
    expect(response.type).toBe("audio/wav");
  });
});
