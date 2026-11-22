import { readdir, readFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { loadLearningHome } from "@tomewise/core";
import { copyExample } from "../../core/test/helpers.ts";
import { startServer, type ToolDirs } from "../src/index.ts";

export const EVENTS = "subjects/morse-code/events";

export async function startTestApp(prepare?: (root: string) => Promise<void>, tool?: ToolDirs) {
  const root = await copyExample("morse");
  await prepare?.(root);
  const reloadErrors: unknown[] = [];
  const start = async () =>
    startServer(await loadLearningHome(root), {
      host: "127.0.0.1",
      port: 0,
      tool,
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
    await stop();
    await whileDown?.();
    server = await start();
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

  async function get(path: string) {
    const response = await fetch(`${server.url}${path}`);
    return { status: response.status, body: (await response.json()) as any };
  }

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

  return {
    root,
    get url() {
      return server.url;
    },
    get,
    raw,
    post,
    lines,
    eventFiles,
    reloadErrors,
    restart,
    stop,
  };
}
