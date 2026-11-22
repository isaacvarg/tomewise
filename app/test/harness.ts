import { readdir, readFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { loadLearningHome } from "@tomewise/core";
import { copyExample } from "../../core/test/helpers.ts";
import { type Clock, startServer, type ToolDirs } from "../src/index.ts";

export const EVENTS = "subjects/morse-code/events";

export async function startTestApp(
  prepare?: (root: string) => Promise<void>,
  tool?: ToolDirs,
  { spa, clock }: { spa?: string; clock?: Clock } = {},
) {
  const root = await copyExample("morse");
  await prepare?.(root);
  const reloadErrors: unknown[] = [];
  const warnings: string[] = [];
  const start = async (port = 0) =>
    startServer(await loadLearningHome(root), {
      host: "127.0.0.1",
      port,
      tool,
      spa,
      clock,
      warn: (message) => warnings.push(message),
      watch: { onError: (error) => reloadErrors.push(error) },
    });
  let server = await start();
  let running = true;
  async function stop() {
    if (!running) return;
    running = false;
    await server.close();
  }
  onTestFinished(stop);

  async function restart(whileDown?: () => Promise<void>) {
    const { port } = new URL(server.url);
    await stop();
    await whileDown?.();
    server = await start(Number(port));
    running = true;
  }

  async function post(body: unknown) {
    const response = await fetch(`${server.url}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  async function send(method: string, path: string) {
    const response = await fetch(`${server.url}${path}`, { method });
    return { status: response.status, body: (await response.json()) as any };
  }

  const get = (path: string) => send("GET", path);

  async function lines(name: string): Promise<any[]> {
    let text: string;
    try {
      text = await readFile(join(root, EVENTS, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
  }

  async function eventFiles(): Promise<string[]> {
    return (await readdir(join(root, EVENTS))).sort();
  }

  function raw(path: string): Promise<{ status: number; type: string | undefined; body: Buffer }> {
    return new Promise((resolve, reject) => {
      request(`${server.url}${path}`, { path }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode!, type: response.headers["content-type"], body: Buffer.concat(chunks) }),
        );
        response.on("error", reject);
      })
        .on("error", reject)
        .end();
    });
  }

  async function changes() {
    const stop = new AbortController();
    onTestFinished(() => stop.abort());
    const response = await fetch(`${server.url}/api/changes`, { signal: stop.signal });
    const received: { event: string; data: any }[] = [];
    const result = { status: response.status, type: response.headers.get("content-type"), received, ended: false };
    void (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for await (const chunk of response.body!) {
          buffer += decoder.decode(chunk, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const field = (name: string) =>
              block
                .split("\n")
                .find((line) => line.startsWith(`${name}:`))
                ?.slice(name.length + 1)
                .trim();
            const event = field("event");
            if (event !== undefined) received.push({ event, data: JSON.parse(field("data") ?? "null") });
          }
        }
      } catch {}
      result.ended = true;
    })();
    return result;
  }

  return {
    root,
    changes,
    get url() {
      return server.url;
    },
    get,
    send,
    raw,
    post,
    lines,
    eventFiles,
    reloadErrors,
    warnings,
    restart,
    stop,
  };
}
