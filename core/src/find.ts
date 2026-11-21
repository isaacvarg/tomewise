import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { GlobalConfigError, LearningHomeNotFoundError } from "./errors.ts";
import { readJson } from "./json.ts";

export const CONFIG_FILE = "tomewise.json";
const HOME_ENV_VAR = "TOMEWISE_HOME";

const GlobalConfig = z.object({ learningHome: z.string().optional() });

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

function globalConfigPath(env: NodeJS.ProcessEnv): string | undefined {
  return env.HOME ? join(env.HOME, ".config", "tomewise", "config.json") : undefined;
}

async function fromGlobalConfig(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const path = globalConfigPath(env);
  if (!path) return undefined;
  const read = await readJson(path);
  if (!read.ok) {
    if (read.missing) return undefined;
    throw new GlobalConfigError(`${path}: ${read.message}`);
  }
  const parsed = GlobalConfig.safeParse(read.value);
  if (!parsed.success) throw new GlobalConfigError(`${path}: ${z.prettifyError(parsed.error)}`);
  const { learningHome } = parsed.data;
  return learningHome ? homeAt(resolve(dirname(path), learningHome)) : undefined;
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
