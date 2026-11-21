#!/usr/bin/env node
import { hostname } from "node:os";
import { text } from "node:stream/consumers";
import {
  appendEvent,
  findLearningHome,
  formatIssue,
  GlobalConfigError,
  InvalidEventError,
  InvalidLearningHomeError,
  LearningHomeNotFoundError,
  loadLearningHome,
  UnsupportedFormatVersionError,
  validateLearningHome,
} from "@tomewise/core";

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  machine?: string;
  readStdin?: () => Promise<string>;
}

const USAGE = ["Usage:", "  tome validate", "  tome log <event JSON>", "  tome log -        read the event from stdin"].join(
  "\n",
);

async function findRoot(io: Io): Promise<string | undefined> {
  try {
    return await findLearningHome({ cwd: io.cwd, env: io.env });
  } catch (error) {
    if (error instanceof LearningHomeNotFoundError || error instanceof GlobalConfigError) {
      io.stderr(error.message);
      return undefined;
    }
    throw error;
  }
}

async function validate(io: Io): Promise<number> {
  const root = await findRoot(io);
  if (!root) return 2;

  const issues = await validateLearningHome(root);
  if (issues.length === 0) {
    io.stdout(`${root} is valid.`);
    return 0;
  }
  for (const issue of issues) io.stderr(formatIssue(issue));
  io.stderr(`${issues.length} ${issues.length === 1 ? "problem" : "problems"} in ${root}`);
  return 1;
}

async function log(io: Io, arg: string | undefined): Promise<number> {
  if (arg === undefined) {
    io.stderr(USAGE);
    return 2;
  }
  const root = await findRoot(io);
  if (!root) return 2;

  const source = arg === "-" ? await (io.readStdin ?? (() => text(process.stdin)))() : arg;
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    io.stderr(formatIssue({ file: "event", path: "", message: `Invalid JSON: ${(error as Error).message}` }));
    return 1;
  }

  try {
    const home = await loadLearningHome(root);
    const { event } = await appendEvent(home, input, { machine: io.machine ?? hostname() });
    io.stdout(JSON.stringify(event));
    return 0;
  } catch (error) {
    if (error instanceof InvalidEventError) {
      for (const issue of error.issues) io.stderr(formatIssue(issue));
      return 1;
    }
    if (error instanceof InvalidLearningHomeError || error instanceof UnsupportedFormatVersionError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
}

export async function run(args: string[], io: Io): Promise<number> {
  const [command, ...rest] = args;
  if (command === "validate") return validate(io);
  if (command === "log") return log(io, rest[0]);
  io.stderr(USAGE);
  return 2;
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  });
}
