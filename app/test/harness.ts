import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { loadLearningHome } from "@tomewise/core";
import { copyExample } from "../../core/test/helpers.ts";
import { startServer } from "../src/index.ts";

export const EVENTS = "subjects/morse-code/events";

export async function startTestApp(prepare?: (root: string) => Promise<void>) {
  const root = await copyExample("morse");
  await prepare?.(root);
  const server = await startServer(await loadLearningHome(root), { host: "127.0.0.1", port: 0 });
  onTestFinished(() => server.close());

  async function post(body: unknown) {
    const response = await fetch(`${server.url}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
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

  return { root, url: server.url, post, lines, eventFiles };
}
