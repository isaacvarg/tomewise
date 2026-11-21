import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { LearningHome } from "@tomewise/core";
import { eventRoutes } from "./events.ts";
import { pageRoutes } from "./pages.ts";
import { BUILT_IN, themeRoutes, type ToolDirs, widgetRoutes } from "./tool-files.ts";

export interface AppOptions {
  tool?: ToolDirs;
}

export function createApp(home: LearningHome, { tool = BUILT_IN }: AppOptions = {}): Hono {
  const app = new Hono();
  app.route("/api/events", eventRoutes(home));
  app.route("/s", pageRoutes(home, tool));
  app.route("/widgets", widgetRoutes(tool));
  app.route("/themes", themeRoutes(home, tool));
  return app;
}

export interface ListenOptions extends AppOptions {
  host: string;
  port: number;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(home: LearningHome, { host, port, ...options }: ListenOptions): Promise<RunningServer> {
  const server = createAdaptorServer({ fetch: createApp(home, options).fetch });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const urlHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${urlHost}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
