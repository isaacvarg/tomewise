import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { GlobalConfigError, LearningHomeNotFoundError } from "./errors.ts";
import { readJson } from "./json.ts";

export const CONFIG_FILE = "tomewise.json";
const HOME_ENV_VAR = "TOMEWISE_HOME";
const URL_ENV_VAR = "TOMEWISE_URL";

export const AppUrl = z.url({ protocol: /^https?$/, error: "Use an http:// or https:// URL" });

const GlobalConfig = z.object({
  learningHome: z.string().optional(),
  appUrl: AppUrl.optional(),
});
type GlobalConfig = z.infer<typeof GlobalConfig>;

export interface FindOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

async function homeAt(dir: string): Promise<string | undefined> {
  try {
    await access(join(dir, CONFIG_FILE));
    return dir;
  } catch {
    return undefined;
  }
}

async function walkUp(start: string): Promise<string | undefined> {
  let dir = start;
  while (true) {
    if (await homeAt(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function globalConfigPath(env: NodeJS.ProcessEnv): string | undefined {
  return env.HOME ? join(env.HOME, ".config", "tomewise", "config.json") : undefined;
}

async function readGlobalConfig(env: NodeJS.ProcessEnv): Promise<{ path: string; config: GlobalConfig } | undefined> {
  const path = globalConfigPath(env);
  if (!path) return undefined;
  const read = await readJson(path);
  if (!read.ok) {
    if (read.missing) return undefined;
    throw new GlobalConfigError(`${path}: ${read.message}`);
  }
  const parsed = GlobalConfig.safeParse(read.value);
  if (!parsed.success) throw new GlobalConfigError(`${path}: ${z.prettifyError(parsed.error)}`);
  return { path, config: parsed.data };
}

async function fromGlobalConfig(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const global = await readGlobalConfig(env);
  const learningHome = global?.config.learningHome;
  return global && learningHome ? homeAt(resolve(dirname(global.path), learningHome)) : undefined;
}

export async function findAppUrl(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const value = env[URL_ENV_VAR];
  if (value) {
    const parsed = AppUrl.safeParse(value);
    if (!parsed.success) throw new GlobalConfigError(`${URL_ENV_VAR} (${value}): ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  }
  return (await readGlobalConfig(env))?.config.appUrl;
}

async function fromEnv(cwd: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const value = env[HOME_ENV_VAR];
  return value ? homeAt(resolve(cwd, value)) : undefined;
}

export async function findLearningHome(options: FindOptions = {}): Promise<string> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const found = (await walkUp(cwd)) ?? (await fromGlobalConfig(env)) ?? (await fromEnv(cwd, env));
  if (found) return found;
  throw new LearningHomeNotFoundError(
    [
      `No learning home found. Looked for ${CONFIG_FILE} in:`,
      `  - ${cwd} and every folder above it`,
      `  - the learningHome named in ${globalConfigPath(env) ?? "the global config (no HOME set)"}`,
      `  - the folder in $${HOME_ENV_VAR}${env[HOME_ENV_VAR] ? ` (${env[HOME_ENV_VAR]})` : " (not set)"}`,
      `Run \`tome init\` to create one, or create ${CONFIG_FILE} containing {"formatVersion": 1} in the folder you want to use.`,
    ].join("\n"),
  );
}
