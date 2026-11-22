import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { LearningHome } from "@tomewise/core";
import { eventRoutes } from "./events.ts";
import { readRoutes } from "./reads.ts";
import { trackRuleChanges } from "./rule-changes.ts";
import { type HomeView, watchLearningHome, type WatchOptions } from "./watcher.ts";

export function createApp(view: () => HomeView): Hono {
  const app = new Hono();
  app.route("/api/events", eventRoutes(() => view().home));
  app.route("/api", readRoutes(view));
  return app;
}

export interface ListenOptions {
  host: string;
  port: number;
  watch?: WatchOptions;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(home: LearningHome, { host, port, watch }: ListenOptions): Promise<RunningServer> {
  const onError = watch?.onError ?? ((error: unknown) => console.error(`Reloading ${home.root} failed:`, error));
  const watched = await watchLearningHome(home, { ...watch, onError });
  await trackRuleChanges(watched, onError);
  const server = createAdaptorServer({ fetch: createApp(watched.current).fetch });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await watched.close();
    throw error;
  }
  const address = server.address() as AddressInfo;
  const urlHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${urlHost}:${address.port}`,
    async close() {
      await watched.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
