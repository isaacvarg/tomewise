import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CONFIG_FILE,
  checkInitSettings,
  DEFAULT_APP_URL,
  initLearningHome,
  type InitProblem,
  type InitSetting,
  type InitSettings,
} from "@tomewise/core";
import { setUpGit } from "./git.ts";
import type { Io } from "./main.ts";
import { createPrompter, PromptCancelled, type Prompter } from "./prompt.ts";

export const INIT_USAGE = [
  "  tome init [<dir>] [--timezone <IANA zone>] [--week-start <weekday>] [--rest-days <0-6>] [--app-url <url>]",
  "            [--git [--remote <url>] | --no-git]",
].join("\n");

const flagFor: Record<InitSetting, string> = {
  timezone: "--timezone",
  weekStart: "--week-start",
  restDaysPerWeek: "--rest-days",
  appUrl: "--app-url",
};

interface Answers {
  dir?: string;
  settings: InitSettings;
  git?: boolean;
  remote?: string;
}

type Parsed = { answers: Answers; problems: InitProblem[] };

function parseInitArgs(args: string[]): Parsed | string {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      allowNegative: true,
      options: {
        timezone: { type: "string" },
        "week-start": { type: "string" },
        "rest-days": { type: "string" },
        "app-url": { type: "string" },
        git: { type: "boolean" },
        remote: { type: "string" },
      },
    }));
  } catch (error) {
    return (error as Error).message;
  }
  if (positionals.length > 1) return `Expected one folder, got ${positionals.length}`;
  if (values.git === false && values.remote !== undefined) return "--remote needs git; drop --no-git or --remote";

  const problems: InitProblem[] = [];
  const rawRestDays = values["rest-days"] as string | undefined;
  let restDaysPerWeek: number | undefined;
  if (rawRestDays !== undefined) {
    const parsed = parseRestDays(rawRestDays);
    if (typeof parsed === "number") restDaysPerWeek = parsed;
    else problems.push({ setting: "restDaysPerWeek", message: parsed.message });
  }

  const remote = values.remote as string | undefined;
  return {
    answers: {
      dir: positionals[0],
      settings: {
        timezone: values.timezone as string | undefined,
        weekStart: values["week-start"] as string | undefined,
        restDaysPerWeek,
        appUrl: values["app-url"] as string | undefined,
      },
      git: remote !== undefined ? true : (values.git as boolean | undefined),
      remote,
    },
    problems,
  };
}

function parseRestDays(raw: string): number | { message: string } {
  return /^\d+$/.test(raw) ? Number(raw) : { message: `Use a whole number from 0 to 6, not "${raw}"` };
}

function problemWith(setting: InitSetting, settings: InitSettings): string | undefined {
  const checked = checkInitSettings(settings);
  return checked.ok ? undefined : checked.problems.find((problem) => problem.setting === setting)?.message;
}

async function askSetting<K extends InitSetting>(
  prompter: Prompter,
  setting: K,
  question: string,
  fallback: string,
  parse: (raw: string) => InitSettings[K] | { message: string },
): Promise<InitSettings[K]> {
  for (;;) {
    const parsed = parse(await prompter.ask(question, fallback));
    if (typeof parsed === "object" && parsed !== null) {
      prompter.say(parsed.message);
      continue;
    }
    const message = problemWith(setting, { [setting]: parsed });
    if (message === undefined) return parsed;
    prompter.say(message);
  }
}

async function askYesNo(prompter: Prompter, question: string, fallback: boolean): Promise<boolean> {
  for (;;) {
    const answer = (await prompter.ask(`${question} [${fallback ? "Y/n" : "y/N"}]`)).toLowerCase();
    if (answer === "") return fallback;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    prompter.say('Answer "y" or "n".');
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ask(io: Io, prompter: Prompter, answers: Answers): Promise<Answers | { exists: string }> {
  const settings = { ...answers.settings };
  const dir = answers.dir ?? (await prompter.ask("Where should the learning home go?", io.cwd));
  const root = resolve(io.cwd, dir);
  if (await exists(join(root, CONFIG_FILE))) return { exists: root };

  settings.timezone ??= await askSetting(prompter, "timezone", "Timezone", Intl.DateTimeFormat().resolvedOptions().timeZone, (raw) => raw);
  settings.weekStart ??= await askSetting(prompter, "weekStart", "Week starts on", "monday", (raw) => raw.toLowerCase());
  settings.restDaysPerWeek ??= await askSetting(prompter, "restDaysPerWeek", "Rest days per week", "0", parseRestDays);
  settings.appUrl ??= await askSetting(prompter, "appUrl", "App URL", DEFAULT_APP_URL, (raw) => raw);

  const git = answers.git ?? (await askYesNo(prompter, "Set up git?", true));
  let remote = answers.remote;
  if (git && answers.git === undefined) {
    const answer = await prompter.ask("Git remote URL (blank for none)");
    remote = answer === "" ? undefined : answer;
  }
  return { dir, settings, git, remote };
}

function report(io: Io, problems: InitProblem[]): void {
  for (const problem of problems) io.stderr(`${flagFor[problem.setting]}: ${problem.message}`);
  io.stderr("Nothing was written.");
}

export async function init(io: Io, args: string[], usage: string): Promise<number> {
  const parsed = parseInitArgs(args);
  if (typeof parsed === "string") {
    io.stderr(parsed);
    io.stderr(usage);
    return 2;
  }
  const checked = checkInitSettings(parsed.answers.settings);
  if (parsed.problems.length > 0 || !checked.ok) {
    report(io, [...parsed.problems, ...(checked.ok ? [] : checked.problems)]);
    return 1;
  }

  let answers = parsed.answers;
  if (io.prompt) {
    const prompter = createPrompter(io.prompt);
    try {
      const asked = await ask(io, prompter, answers);
      if ("exists" in asked) {
        io.stderr(`${asked.exists} is already a learning home; nothing was changed.`);
        return 1;
      }
      answers = asked;
    } catch (error) {
      if (!(error instanceof PromptCancelled)) throw error;
      io.stderr("Cancelled. Nothing was written.");
      return 130;
    } finally {
      prompter.close();
    }
  }

  const result = await initLearningHome(answers.dir ?? ".", answers.settings, { cwd: io.cwd, env: io.env });
  switch (result.kind) {
    case "created": {
      io.stdout(`Created a learning home in ${result.root}.`);
      io.stdout(`Saved it as your learning home in ${result.globalConfig}.`);
      if (!answers.git) return 0;
      const git = await setUpGit(result.root, answers.remote);
      if (!git.ok) {
        io.stderr(`Git setup failed: ${git.message}`);
        return 1;
      }
      io.stdout(answers.remote ? `Initialised git with remote origin ${answers.remote}.` : "Initialised git.");
      return 0;
    }
    case "exists":
      io.stderr(`${result.root} is already a learning home; nothing was changed.`);
      return 1;
    case "invalid":
      report(io, result.problems);
      return 1;
    case "global-config":
      io.stderr(result.message);
      io.stderr("Nothing was written.");
      return 1;
  }
}
