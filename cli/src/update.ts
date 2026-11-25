import { checkForUpdate, type Update, updateCachePath } from "@tomewise/core";
import cli from "../package.json" with { type: "json" };

export const VERSION: string = cli.version;

const QUIET_COMMANDS = new Set(["serve"]);
const CLI_TIMEOUT_MS = 1500;
export const SERVER_TIMEOUT_MS = 5000;

export interface CliUpdateOptions {
  args: string[];
  env: NodeJS.ProcessEnv;
  interactive: boolean;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function cliUpdateCheck({ args, env, interactive, fetch, now }: CliUpdateOptions): Promise<Update | null> | undefined {
  const [command] = args;
  if (!interactive || command === undefined || QUIET_COMMANDS.has(command) || args.includes("--json")) return undefined;
  if (env.npm_command === "exec") return undefined;
  return checkForUpdate({ current: VERSION, env, cacheFile: updateCachePath(env), timeoutMs: CLI_TIMEOUT_MS, fetch, now });
}
