import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it, onTestFinished } from "vitest";
import { buildHome, copyExample } from "../../core/test/helpers.ts";
import { run } from "../src/main.ts";

async function serve(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const stop = new AbortController();
  let listening!: (line: string) => void;
  const started = new Promise<string>((resolve) => (listening = resolve));
  const exit = run(["serve", ...args], {
    cwd,
    env: { HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")), ...env },
    signal: stop.signal,
    stdout: (line) => {
      out.push(line);
      listening(line);
    },
    stderr: (line) => err.push(line),
  });
  onTestFinished(async () => {
    stop.abort();
    await exit;
  });
  const first = await Promise.race([started, exit.then((code) => `exited ${code}`)]);
  return { first, exit, stderr: () => err.join("\n"), stop: () => stop.abort() };
}

function urlIn(line: string): string {
  const match = /^Listening on (http:\/\/\S+)$/.exec(line);
  if (!match) throw new Error(`Not a listening line: ${line}`);
  return match[1]!;
}

describe("tome serve", () => {
  it("prints the URL it listens on, serves events there, and exits 0 when stopped", async () => {
    const root = await copyExample("morse");
    const server = await serve(["--port", "0"], root);

    const url = urlIn(server.first);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${url}/api/events`, { method: "POST", body: "[]" })).status).toBe(400);
    server.stop();
    expect(await server.exit).toBe(0);
  });

  it("takes the host and port from flags over env vars", async () => {
    const root = await copyExample("morse");
    const server = await serve(["--host=localhost", "--port", "0"], root, { TOMEWISE_HOST: "0.0.0.0", TOMEWISE_PORT: "1" });

    expect(urlIn(server.first)).toMatch(/^http:\/\/(127\.0\.0\.1|\[::1\]):\d+$/);
  });

  it("takes the host and port from env vars when there are no flags", async () => {
    const root = await copyExample("morse");
    const server = await serve([], root, { TOMEWISE_HOST: "::1", TOMEWISE_PORT: "0" });

    expect(urlIn(server.first)).toMatch(/^http:\/\/\[::1\]:\d+$/);
  });

  it("listens on 127.0.0.1:4777 when nothing says otherwise", async () => {
    const root = await copyExample("morse");
    const server = await serve([], root);

    if (server.first.startsWith("Listening")) expect(urlIn(server.first)).toBe("http://127.0.0.1:4777");
    else expect(server.stderr()).toMatch(/127\.0\.0\.1:4777 is already in use/);
  });

  it("refuses a port that isn't a number", async () => {
    const root = await copyExample("morse");
    const server = await serve(["--port", "abc"], root);

    expect(server.first).toBe("exited 2");
    expect(server.stderr()).toMatch(/--port/);
  });

  it("refuses to start without a learning home", async () => {
    const server = await serve(["--port", "0"], await mkdtemp(join(tmpdir(), "tomewise-nowhere-")));

    expect(server.first).toBe("exited 2");
    expect(server.stderr()).toMatch(/^No learning home found/);
  });

  it("refuses to start against an invalid learning home and says what's wrong", async () => {
    const root = await buildHome({
      "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
      "subjects/morse-code/subject.json": { name: 7 },
    });
    const server = await serve(["--port", "0"], root);

    expect(server.first).toBe("exited 1");
    expect(server.stderr()).toMatch(/^subjects\/morse-code\/subject\.json: name: /m);
  });

  it.skipIf(process.getuid?.() === 0)("refuses to start against a learning home it can't read", async () => {
    const root = await copyExample("morse");
    await writeFile(join(root, "tomewise.json"), JSON.stringify({ formatVersion: 1 }));
    await chmod(join(root, "tomewise.json"), 0o000);
    onTestFinished(() => chmod(join(root, "tomewise.json"), 0o644));
    const server = await serve(["--port", "0"], root);

    expect(server.first).toBe("exited 1");
    expect(server.stderr()).toMatch(/tomewise\.json/);
  });

  it("serves a home whose only problem is a lesson that stacks item widgets", async () => {
    const root = await copyExample("morse");
    await writeFile(join(root, "subjects/morse-code/lessons/0001-k-and-m.html"), `<h1>K and M</h1>\n${'<tome-audio ref="item:letter-k" choices="K M"></tome-audio>\n'.repeat(3)}<tome-done></tome-done>`);
    const server = await serve(["--port", "0"], root);

    expect(urlIn(server.first)).toMatch(/^http:/);
    server.stop();
    expect(await server.exit).toBe(0);
  });

  it("runs as a real process and stops on SIGTERM", async () => {
    const root = await copyExample("morse");
    const main = new URL("../src/main.ts", import.meta.url).pathname;
    const child = spawn(process.execPath, [main, "serve", "--port", "0"], { cwd: root });
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    onTestFinished(() => {
      child.kill("SIGKILL");
    });

    const [line] = (await once(createInterface({ input: child.stdout }), "line")) as [string];
    expect((await fetch(`${urlIn(line)}/api/events`, { method: "POST", body: "{" })).status).toBe(400);
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
  });
});
