import { readFile } from "node:fs/promises";
import { DEFAULT_THEME, type LearningHome, ThemeManifest } from "@tomewise/core";
import { resolveUnder } from "./files.ts";
import { themeDir, type ToolDirs } from "./tool-files.ts";

export type Warn = (message: string) => void;

export interface Theme {
  name: string;
  hasThemeCss: boolean;
  script?: string;
}

async function readTheme(home: LearningHome, tool: ToolDirs, name: string, warn: Warn): Promise<Theme | undefined> {
  const dir = await themeDir(home, tool, name);
  if (!dir || !(await resolveUnder(dir, "tokens.css"))) return undefined;
  const theme: Theme = { name, hasThemeCss: (await resolveUnder(dir, "theme.css")) !== undefined };
  const manifestFile = await resolveUnder(dir, "theme.json");
  if (!manifestFile) return theme;
  let manifest: ThemeManifest;
  try {
    manifest = ThemeManifest.parse(JSON.parse(await readFile(manifestFile, "utf8")));
  } catch (error) {
    warn(`Theme "${name}" has an invalid theme.json, so its script won't load: ${(error as Error).message}`);
    return theme;
  }
  if (manifest.script && (await resolveUnder(dir, manifest.script))) theme.script = manifest.script;
  return theme;
}

export function themeResolver(tool: ToolDirs, warn: Warn) {
  const warned = new Set<string>();
  const warnOnce: Warn = (message) => {
    if (warned.has(message)) return;
    warned.add(message);
    warn(message);
  };
  return async function resolveTheme(home: LearningHome, requested = home.config.theme): Promise<Theme | undefined> {
    const chosen = await readTheme(home, tool, requested, warnOnce);
    if (chosen || requested === DEFAULT_THEME) return chosen;
    warnOnce(`Theme "${requested}" is not in themes/ or the built-in themes; using Paper.`);
    return readTheme(home, tool, DEFAULT_THEME, warnOnce);
  };
}

export type ResolveTheme = ReturnType<typeof themeResolver>;
