#!/usr/bin/env node
import {
  findLearningHome,
  formatIssue,
  GlobalConfigError,
  LearningHomeNotFoundError,
  validateLearningHome,
} from "@tomewise/core";

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const USAGE = "Usage: tome validate";

async function validate(io: Io): Promise<number> {
  let root: string;
  try {
    root = await findLearningHome({ cwd: io.cwd, env: io.env });
  } catch (error) {
    if (error instanceof LearningHomeNotFoundError || error instanceof GlobalConfigError) {
      io.stderr(error.message);
      return 2;
    }
    throw error;
  }

  const issues = await validateLearningHome(root);
  if (issues.length === 0) {
    io.stdout(`${root} is valid.`);
    return 0;
  }
  for (const issue of issues) io.stderr(formatIssue(issue));
  io.stderr(`${issues.length} ${issues.length === 1 ? "problem" : "problems"} in ${root}`);
  return 1;
}

export async function run(args: string[], io: Io): Promise<number> {
  const [command] = args;
  if (command === "validate") return validate(io);
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
