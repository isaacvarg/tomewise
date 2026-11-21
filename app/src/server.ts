import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { LearningHome } from "@tomewise/core";
import { eventRoutes } from "./events.ts";
import { pageRoutes } from "./pages.ts";

export function createApp(home: LearningHome): Hono {
  const app = new Hono();
  app.route("/api/events", eventRoutes(home));
  app.route("/s", pageRoutes(home));
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

export async function startServer(home: LearningHome, { host, port }: ListenOptions): Promise<RunningServer> {
  const server = createAdaptorServer({ fetch: createApp(home).fetch });
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
