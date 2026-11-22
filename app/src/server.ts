import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { LearningHome } from "@tomewise/core";
import { eventRoutes } from "./events.ts";
import { pageRoutes } from "./pages.ts";
import { readRoutes } from "./reads.ts";
import { trackRuleChanges } from "./rule-changes.ts";
import { spaRoutes } from "./spa.ts";
import { styleguideRoutes } from "./styleguide.ts";
import { type Clock, type GitSync, startSync, syncOff, syncRoutes, systemClock } from "./sync.ts";
import { themeResolver, type Warn } from "./themes.ts";
import { BUILT_IN, themeRoutes, type ToolDirs, widgetRoutes } from "./tool-files.ts";
import { type HomeView, watchLearningHome, type WatchOptions } from "./watcher.ts";

export interface AppOptions {
  spa?: string;
  tool?: ToolDirs;
  warn?: Warn;
  sync?: GitSync;
  clock?: Clock;
}

export function createApp(
  view: () => HomeView,
  { spa, tool = BUILT_IN, warn = console.warn, sync = syncOff, clock = systemClock }: AppOptions = {},
): Hono {
  const app = new Hono();
  const home = () => view().home;
  const resolveTheme = themeResolver(tool, warn);
  app.route("/api/events", eventRoutes(home, sync));
  app.route("/api/sync", syncRoutes(sync));
  app.route("/api", readRoutes(view, () => clock.now()));
  app.route("/s", pageRoutes(home, resolveTheme));
  app.route("/widgets", widgetRoutes(tool));
  app.route("/themes", themeRoutes(home, tool));
  app.route("/styleguide", styleguideRoutes(home, resolveTheme, { spa }));
  if (spa !== undefined && existsSync(spa)) app.route("/", spaRoutes(spa, home, resolveTheme));
  return app;
}

export interface ListenOptions extends Omit<AppOptions, "sync" | "clock"> {
  host: string;
  port: number;
  watch?: WatchOptions;
  clock?: Clock;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(home: LearningHome, { host, port, watch, clock, ...options }: ListenOptions): Promise<RunningServer> {
  const onError = watch?.onError ?? ((error: unknown) => console.error(`Reloading ${home.root} failed:`, error));
  const watched = await watchLearningHome(home, { ...watch, onError });
  const sync = startSync(() => watched.current().home, { clock });
  await trackRuleChanges(watched, sync.exclusive, onError);
  const server = createAdaptorServer({ fetch: createApp(watched.current, { ...options, sync, clock }).fetch });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await sync.close();
    await watched.close();
    throw error;
  }
  const address = server.address() as AddressInfo;
  const urlHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${urlHost}:${address.port}`,
    async close() {
      await sync.close();
      await watched.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
