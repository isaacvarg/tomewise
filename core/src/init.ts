import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AppUrl, CONFIG_FILE, globalConfigPath } from "./find.ts";
import { readJson } from "./json.ts";
import { SUPPORTED_FORMAT_VERSION, systemTimezone, TomewiseConfig } from "./schemas.ts";

export const DEFAULT_APP_URL = "http://127.0.0.1:4777";

export interface InitSettings {
  timezone?: string;
  weekStart?: string;
  restDaysPerWeek?: number;
  appUrl?: string;
}

export type InitSetting = keyof InitSettings;

export interface InitProblem {
  setting: InitSetting;
  message: string;
}

export interface InitOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export type InitResult =
  | { kind: "created"; root: string; globalConfig: string }
  | { kind: "exists"; root: string }
  | { kind: "invalid"; problems: InitProblem[] }
  | { kind: "global-config"; message: string };

interface Checked {
  config: Record<string, unknown>;
  appUrl: string;
}

const settingAt: Record<string, InitSetting> = {
  timezone: "timezone",
  weekStart: "weekStart",
  streak: "restDaysPerWeek",
};

export function checkInitSettings(settings: InitSettings): { ok: true; checked: Checked } | { ok: false; problems: InitProblem[] } {
  const config = {
    formatVersion: SUPPORTED_FORMAT_VERSION,
    timezone: settings.timezone ?? systemTimezone(),
    weekStart: settings.weekStart ?? "monday",
    streak: { restDaysPerWeek: settings.restDaysPerWeek ?? 0 },
  };
  const appUrl = settings.appUrl ?? DEFAULT_APP_URL;
  const problems: InitProblem[] = [];

  const parsed = TomewiseConfig.safeParse(config);
  for (const issue of parsed.error?.issues ?? []) {
    const setting = settingAt[String(issue.path[0])];
    if (setting) problems.push({ setting, message: issue.message });
  }
  const url = AppUrl.safeParse(appUrl);
  for (const issue of url.error?.issues ?? []) problems.push({ setting: "appUrl", message: issue.message });

  return problems.length > 0 ? { ok: false, problems } : { ok: true, checked: { config, appUrl } };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readGlobalConfigObject(path: string): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  const read = await readJson(path);
  if (!read.ok) return read.missing ? { ok: true, value: {} } : { ok: false, message: `${path}: ${read.message}` };
  if (typeof read.value !== "object" || read.value === null || Array.isArray(read.value)) {
    return { ok: false, message: `${path}: Expected a JSON object` };
  }
  return { ok: true, value: read.value as Record<string, unknown> };
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function initLearningHome(dir: string, settings: InitSettings, options: InitOptions = {}): Promise<InitResult> {
  const env = options.env ?? process.env;
  const root = resolve(options.cwd ?? process.cwd(), dir);

  if (await exists(join(root, CONFIG_FILE))) return { kind: "exists", root };

  const checked = checkInitSettings(settings);
  if (!checked.ok) return { kind: "invalid", problems: checked.problems };

  const globalConfig = globalConfigPath(env);
  if (!globalConfig) return { kind: "global-config", message: "HOME is not set, so there is nowhere to write the global config" };
  const global = await readGlobalConfigObject(globalConfig);
  if (!global.ok) return { kind: "global-config", message: global.message };

  await mkdir(join(root, "subjects"), { recursive: true });
  await writeFile(join(root, CONFIG_FILE), jsonText(checked.checked.config), { flag: "wx" });
  await mkdir(dirname(globalConfig), { recursive: true });
  await writeFile(globalConfig, jsonText({ ...global.value, learningHome: root, appUrl: checked.checked.appUrl }));

  return { kind: "created", root, globalConfig };
}
