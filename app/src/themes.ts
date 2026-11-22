import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_THEME, type LearningHome, ThemeManifest, ThemeName } from "@tomewise/core";
import { resolveUnder } from "./files.ts";
import { themeDir, type ToolDirs } from "./tool-files.ts";

export type Warn = (message: string) => void;

export interface Theme {
  name: string;
  label: string;
  description?: string;
  hasThemeCss: boolean;
  script?: string;
}

async function readTheme(home: LearningHome, tool: ToolDirs, name: string, warn: Warn): Promise<Theme | undefined> {
  const dir = await themeDir(home, tool, name);
  if (!dir || !(await resolveUnder(dir, "tokens.css"))) return undefined;
  const theme: Theme = { name, label: name, hasThemeCss: (await resolveUnder(dir, "theme.css")) !== undefined };
  const manifestFile = await resolveUnder(dir, "theme.json");
  if (!manifestFile) return theme;
  let manifest: ThemeManifest;
  try {
    manifest = ThemeManifest.parse(JSON.parse(await readFile(manifestFile, "utf8")));
  } catch (error) {
    warn(`Theme "${name}" has an invalid theme.json, so its script won't load: ${(error as Error).message}`);
    return theme;
  }
  theme.label = manifest.name;
  if (manifest.description) theme.description = manifest.description;
  if (manifest.script && (await resolveUnder(dir, manifest.script))) theme.script = manifest.script;
  return theme;
}

async function folderNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function listThemes(home: LearningHome, tool: ToolDirs, warn: Warn): Promise<Theme[]> {
  const names = new Set([...(await folderNames(join(home.root, "themes"))), ...(await folderNames(tool.themes))]);
  const themes = await Promise.all([...names].filter((name) => ThemeName.safeParse(name).success).sort().map((name) => readTheme(home, tool, name, warn)));
  return themes.filter((theme) => theme !== undefined);
}

export function onlyOnce(warn: Warn): Warn {
  const warned = new Set<string>();
  return (message) => {
    if (warned.has(message)) return;
    warned.add(message);
    warn(message);
  };
}

export function themeResolver(tool: ToolDirs, warn: Warn) {
  const warnOnce = onlyOnce(warn);
  return async function resolveTheme(home: LearningHome, requested = home.config.theme): Promise<Theme | undefined> {
    const chosen = await readTheme(home, tool, requested, warnOnce);
    if (chosen || requested === DEFAULT_THEME) return chosen;
    warnOnce(`Theme "${requested}" is not in themes/ or the built-in themes; using Paper.`);
    return readTheme(home, tool, DEFAULT_THEME, warnOnce);
  };
}

export type ResolveTheme = ReturnType<typeof themeResolver>;
