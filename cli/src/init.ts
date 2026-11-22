import { parseArgs } from "node:util";
import { checkInitSettings, initLearningHome, type InitProblem, type InitSetting, type InitSettings } from "@tomewise/core";
import type { Io } from "./main.ts";

export const INIT_USAGE =
  "  tome init [<dir>] [--timezone <IANA zone>] [--week-start <weekday>] [--rest-days <0-6>] [--app-url <url>]";

const flagFor: Record<InitSetting, string> = {
  timezone: "--timezone",
  weekStart: "--week-start",
  restDaysPerWeek: "--rest-days",
  appUrl: "--app-url",
};

type Parsed = { dir: string; settings: InitSettings; problems: InitProblem[] };

function parseInitArgs(args: string[]): Parsed | string {
  let values: Record<string, string | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        timezone: { type: "string" },
        "week-start": { type: "string" },
        "rest-days": { type: "string" },
        "app-url": { type: "string" },
      },
    }));
  } catch (error) {
    return (error as Error).message;
  }
  if (positionals.length > 1) return `Expected one folder, got ${positionals.length}`;

  const problems: InitProblem[] = [];
  const rawRestDays = values["rest-days"];
  let restDaysPerWeek: number | undefined;
  if (rawRestDays !== undefined) {
    if (/^\d+$/.test(rawRestDays)) restDaysPerWeek = Number(rawRestDays);
    else problems.push({ setting: "restDaysPerWeek", message: `Use a whole number from 0 to 6, not "${rawRestDays}"` });
  }

  return {
    dir: positionals[0] ?? ".",
    settings: { timezone: values.timezone, weekStart: values["week-start"], restDaysPerWeek, appUrl: values["app-url"] },
    problems,
  };
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
  if (parsed.problems.length > 0) {
    const checked = checkInitSettings(parsed.settings);
    report(io, [...parsed.problems, ...(checked.ok ? [] : checked.problems)]);
    return 1;
  }

  const result = await initLearningHome(parsed.dir, parsed.settings, { cwd: io.cwd, env: io.env });
  switch (result.kind) {
    case "created":
      io.stdout(`Created a learning home in ${result.root}.`);
      io.stdout(`Saved it as your learning home in ${result.globalConfig}.`);
      return 0;
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
