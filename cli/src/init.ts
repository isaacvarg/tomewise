import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CONFIG_FILE,
  checkInitSettings,
  DEFAULT_APP_URL,
  DEFAULT_GIT_CADENCE,
  GIT_CADENCES,
  initLearningHome,
  type InitProblem,
  type InitSetting,
  type InitSettings,
} from "@tomewise/core";
import { GIT_REMOTE, setUpGit } from "./git.ts";
import { APP_CHOICES, handOff, isAppChoice, listenFor, type AppChoice, type Launch } from "./handoff.ts";
import type { Io } from "./main.ts";
import { createPrompter, PromptCancelled, type Prompter } from "./prompt.ts";

export const INIT_USAGE = [
  "  tome init [<dir>] [--timezone <IANA zone>] [--week-start <weekday>] [--rest-days <0-6>] [--app-url <url>]",
  "            [--git [--remote <url>] [--cadence <session|hourly|daily>] [--push | --no-push] | --no-git]",
  "            [--app <now|service|docker|none>] [--subject <topic> | --no-subject]",
].join("\n");

const flagFor: Record<InitSetting, string> = {
  timezone: "--timezone",
  weekStart: "--week-start",
  restDaysPerWeek: "--rest-days",
  appUrl: "--app-url",
  cadence: "--cadence",
  push: "--push",
};

interface Answers {
  dir?: string;
  settings: InitSettings;
  remoteUrl?: string;
  app?: AppChoice;
  subject?: string | false;
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
        cadence: { type: "string" },
        push: { type: "boolean" },
        app: { type: "string" },
        subject: { type: "string" },
      },
    }));
  } catch (error) {
    return (error as Error).message;
  }
  if (positionals.length > 1) return `Expected one folder, got ${positionals.length}`;
  const gitFlags = [
    values.remote !== undefined && "--remote",
    values.cadence !== undefined && "--cadence",
    values.push === true && "--push",
    values.push === false && "--no-push",
  ].filter((flag) => flag !== false);
  if (values.git === false && gitFlags.length > 0) return `${gitFlags[0]} needs git; drop --no-git or ${gitFlags[0]}`;
  const app = values.app as string | undefined;
  if (app !== undefined && !isAppChoice(app)) return `--app takes ${APP_CHOICES.join(", ")}, not "${app}"`;
  const subject = values.subject as string | false | undefined;

  const problems: InitProblem[] = [];
  const rawRestDays = values["rest-days"] as string | undefined;
  let restDaysPerWeek: number | undefined;
  if (rawRestDays !== undefined) {
    const parsed = parseRestDays(rawRestDays);
    if (typeof parsed === "number") restDaysPerWeek = parsed;
    else problems.push({ setting: "restDaysPerWeek", message: parsed.message });
  }

  return {
    answers: {
      dir: positionals[0],
      settings: {
        timezone: values.timezone as string | undefined,
        weekStart: values["week-start"] as string | undefined,
        restDaysPerWeek,
        appUrl: values["app-url"] as string | undefined,
        git: gitFlags.length > 0 ? true : (values.git as boolean | undefined),
        cadence: values.cadence as string | undefined,
        push: values.push as boolean | undefined,
      },
      remoteUrl: values.remote as string | undefined,
      app,
      subject: subject === "" ? undefined : subject,
    },
    problems,
  };
}

function parseRestDays(raw: string): number | { message: string } {
  return /^\d+$/.test(raw) ? Number(raw) : { message: `Use a whole number from 0 to 6, not "${raw}"` };
}

function coreSettings(answers: Answers): InitSettings {
  return { ...answers.settings, remote: answers.remoteUrl === undefined ? undefined : GIT_REMOTE };
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

function isOneOf<T extends string>(choices: readonly T[], answer: string): answer is T {
  return (choices as readonly string[]).includes(answer);
}

async function askChoice<T extends string>(prompter: Prompter, question: string, choices: readonly T[], fallback: T): Promise<T> {
  for (;;) {
    const answer = (await prompter.ask(`${question} (${choices.join("/")})`, fallback)).toLowerCase();
    if (isOneOf(choices, answer)) return answer;
    prompter.say(`Answer ${choices.slice(0, -1).map((choice) => `"${choice}"`).join(", ")} or "${choices.at(-1)}".`);
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

  settings.git ??= await askYesNo(prompter, "Set up git?", true);
  let remoteUrl = answers.remoteUrl;
  if (settings.git) {
    while (remoteUrl === undefined) {
      const answer = await prompter.ask("Git remote URL (blank for none)");
      if (answer !== "") remoteUrl = answer;
      else if (settings.push) prompter.say("--push needs a remote; enter its URL.");
      else break;
    }
    settings.cadence ??= await askChoice(prompter, "Commit practice after each session, hourly or daily?", GIT_CADENCES, DEFAULT_GIT_CADENCE);
    if (remoteUrl !== undefined) settings.push ??= await askYesNo(prompter, "Push to the remote after each commit?", true);
  }

  const app = answers.app ?? (await askChoice(prompter, "Run the app now, install it as a service, or print the Docker command?", APP_CHOICES, "now"));
  let subject = answers.subject;
  if (subject === undefined) {
    const answer = await prompter.ask("What do you want to learn first? (blank to skip)");
    subject = answer === "" ? false : answer;
  }
  return { dir, settings, remoteUrl, app, subject };
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
  const checked = checkInitSettings(coreSettings(parsed.answers));
  const remoteStillAsked = io.prompt !== undefined && parsed.answers.remoteUrl === undefined;
  const problems = [
    ...parsed.problems,
    ...(checked.ok ? [] : checked.problems.filter((problem) => !(remoteStillAsked && problem.setting === "push"))),
  ];
  if (problems.length > 0) {
    report(io, problems);
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

  const app = answers.app ?? "none";
  let launch: Launch | undefined;
  if (app !== "none") {
    const listen = listenFor(io, answers.settings.appUrl);
    if (typeof listen === "string") {
      io.stderr(listen);
      io.stderr("Nothing was written.");
      return 2;
    }
    launch = { app, listen };
  }

  const result = await initLearningHome(answers.dir ?? ".", coreSettings(answers), { cwd: io.cwd, env: io.env });
  switch (result.kind) {
    case "created": {
      io.stdout(`Created a learning home in ${result.root}.`);
      io.stdout(`Saved it as your learning home in ${result.globalConfig}.`);
      if (answers.settings.git) {
        const git = await setUpGit(result.root, answers.remoteUrl);
        if (!git.ok) {
          io.stderr(`Git setup failed: ${git.message}`);
          return 1;
        }
        io.stdout(answers.remoteUrl ? `Initialised git with remote ${GIT_REMOTE} ${answers.remoteUrl}.` : "Initialised git.");
      }
      return handOff(io, { root: result.root, subject: answers.subject, launch });
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
