#!/usr/bin/env node
import { hostname } from "node:os";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { BUILT_SPA, startServer } from "@tomewise/app";
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
  signal?: AbortSignal;
}

const USAGE = [
  "Usage:",
  "  tome validate",
  "  tome log <event JSON>",
  "  tome log -        read the event from stdin",
  "  tome serve [--host <host>] [--port <port>]",
].join("\n");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4777;

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
    const { event } = await appendEvent(home, input, { target: { machine: io.machine ?? hostname() } });
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

function listenOptions(args: string[], env: NodeJS.ProcessEnv): { host: string; port: number } | string {
  let values: { host?: string; port?: string };
  try {
    ({ values } = parseArgs({ args, options: { host: { type: "string" }, port: { type: "string" } } }));
  } catch (error) {
    return (error as Error).message;
  }
  const host = values.host ?? env.TOMEWISE_HOST ?? DEFAULT_HOST;
  const rawPort = values.port ?? env.TOMEWISE_PORT;
  if (rawPort === undefined) return { host, port: DEFAULT_PORT };
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port > 65535) {
    return `${values.port === undefined ? "TOMEWISE_PORT" : "--port"} must be a port number from 0 to 65535, not "${rawPort}"`;
  }
  return { host, port };
}

function stopped(signal: AbortSignal | undefined): Promise<void> {
  if (signal) {
    return signal.aborted ? Promise.resolve() : new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
  }
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
}

async function serve(io: Io, args: string[]): Promise<number> {
  const listen = listenOptions(args, io.env);
  if (typeof listen === "string") {
    io.stderr(listen);
    io.stderr(USAGE);
    return 2;
  }
  const root = await findRoot(io);
  if (!root) return 2;

  const issues = await validateLearningHome(root);
  if (issues.length > 0) {
    for (const issue of issues) io.stderr(formatIssue(issue));
    io.stderr(`Not serving ${root}: ${issues.length} ${issues.length === 1 ? "problem" : "problems"}. Run \`tome validate\` after fixing.`);
    return 1;
  }

  const home = await loadLearningHome(root);
  let server;
  try {
    server = await startServer(home, { ...listen, spa: BUILT_SPA });
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    if (!code) throw error;
    io.stderr(
      code === "EADDRINUSE"
        ? `${listen.host}:${listen.port} is already in use. Pick another with --port or TOMEWISE_PORT.`
        : `Cannot listen on ${listen.host}:${listen.port}: ${message}`,
    );
    return 1;
  }
  io.stdout(`Listening on ${server.url}`);
  await stopped(io.signal);
  await server.close();
  return 0;
}

export async function run(args: string[], io: Io): Promise<number> {
  const [command, ...rest] = args;
  if (command === "validate") return validate(io);
  if (command === "log") return log(io, rest[0]);
  if (command === "serve") return serve(io, rest);
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
