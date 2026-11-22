import { type Context, Hono } from "hono";
import {
  APP_SETTINGS,
  InvalidLearningHomeError,
  InvalidSettingError,
  isAppSetting,
  type LearningHome,
  ThemeName,
  type TomewiseConfig,
  UnsupportedFormatVersionError,
  writeSetting,
} from "@tomewise/core";
import type { GitSync } from "./sync.ts";
import { listThemes, onlyOnce, type Theme, type Warn } from "./themes.ts";
import type { ToolDirs } from "./tool-files.ts";

function themeChoice({ name, label, description, hasThemeCss, script }: Theme) {
  return {
    name,
    label,
    ...(description === undefined ? {} : { description }),
    stylesheets: hasThemeCss ? ["tokens.css", "theme.css"] : ["tokens.css"],
    ...(script === undefined ? {} : { script }),
  };
}

export interface SettingsDeps {
  tool: ToolDirs;
  sync: GitSync;
  warn: Warn;
  reload: () => Promise<void>;
}

export function settingsRoutes(home: () => LearningHome, { tool, sync, warn, reload }: SettingsDeps): Hono {
  const routes = new Hono();
  const warnOnce = onlyOnce(warn);

  async function settings(c: Context, config: TomewiseConfig) {
    const themes = await listThemes(home(), tool, warnOnce);
    return c.json({ theme: config.theme, start: config.start, subjects: config.subjects, themes: themes.map(themeChoice) });
  }

  routes.get("/", (c) => settings(c, home().config));

  routes.put("/:key", async (c) => {
    const key = c.req.param("key");
    if (!isAppSetting(key)) return c.json({ error: `The app saves only ${APP_SETTINGS.slice(0, -1).join(", ")} or ${APP_SETTINGS.at(-1)}; edit tomewise.json for ${key}` }, 404);
    let body: { value?: unknown };
    try {
      body = await c.req.json();
    } catch (error) {
      return c.json({ error: `Invalid JSON: ${(error as Error).message}` }, 400);
    }
    if (typeof body !== "object" || body === null || !("value" in body)) return c.json({ error: 'Send { "value": … }' }, 400);
    const { value } = body;
    if (key === "theme" && ThemeName.safeParse(value).success) {
      const themes = await listThemes(home(), tool, warnOnce);
      if (!themes.some((theme) => theme.name === value)) {
        return c.json({ error: `No theme ${JSON.stringify(value)} in themes/ or the built-in themes` }, 400);
      }
    }
    const config = await sync.exclusive(() => writeSetting(home().root, key, value));
    await reload();
    return settings(c, config);
  });

  routes.onError((error, c) => {
    if (error instanceof InvalidSettingError) return c.json({ error: error.message }, 400);
    if (error instanceof InvalidLearningHomeError || error instanceof UnsupportedFormatVersionError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  });

  return routes;
}
