import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { LearningHome } from "@tomewise/core";
import { eventRoutes } from "./events.ts";
import { spaRoutes } from "./spa.ts";

export interface AppOptions {
  spa?: string;
}

export function createApp(home: LearningHome, { spa }: AppOptions = {}): Hono {
  const app = new Hono();
  app.route("/api/events", eventRoutes(home));
  if (spa !== undefined && existsSync(spa)) app.route("/", spaRoutes(spa));
  return app;
}

export interface ListenOptions {
  host: string;
  port: number;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(home: LearningHome, { host, port, ...options }: ListenOptions & AppOptions): Promise<RunningServer> {
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
