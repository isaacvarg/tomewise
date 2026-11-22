#!/usr/bin/env node
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { hostname } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import {
  appendEvent,
  findAppUrl,
  findLearningHome,
  formatIssue,
  GlobalConfigError,
  InvalidEventError,
  InvalidLearningHomeError,
  LearningHomeNotFoundError,
  loadLearningHome,
  QueryError,
  queryPayload,
  readStats,
  type Stats,
  SubjectNotFoundError,
  UnsupportedFormatVersionError,
  validateLearningHome,
  type Aggregate,
  type QueryResult,
  type ValidationIssue,
} from "@tomewise/core";
import { due } from "./due.ts";
import { INIT_USAGE, init } from "./init.ts";
import { installService, serviceHost, serviceStatus, uninstallService, type ServiceHost } from "./service.ts";
import { listenOptions, serveHome } from "./serve.ts";
import { importWorkspace } from "./import.ts";
import type { PromptStreams } from "./prompt.ts";
import { THEME_USAGE, themeCheck } from "./theme-check.ts";
import type { ToolDirs } from "@tomewise/app";

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  machine?: string;
  readStdin?: () => Promise<string>;
  signal?: AbortSignal;
  service?: Partial<ServiceHost>;
  prompt?: PromptStreams;
  tool?: ToolDirs;
}

export const USAGE = [
  "Usage:",
  INIT_USAGE,
  "  tome validate",
  "  tome log <event JSON>",
  "  tome log -        read the event from stdin",
  "  tome due [<subject>] [--date YYYY-MM-DD] [--json]",
  "  tome serve [--host <host>] [--port <port>]",
  "  tome stats [subject] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]",
  "  tome query <subject> --field <data field> --agg <count|mean|median|min|max>",
  "             [--where <envelope field>=<value>]... [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]",
  "  tome service install [--host <host>] [--port <port>]",
  "  tome service uninstall",
  "  tome service status [--json]",
  "  tome import <dir> [--slug <slug>] [--name <name>]",
  THEME_USAGE,
].join("\n");

export const NO_APP_URL = "No app URL set (appUrl in ~/.config/tomewise/config.json or TOMEWISE_URL)";

const SEND_TIMEOUT_MS = 2000;

export async function findRoot(io: Io): Promise<string | undefined> {
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

export type Sent =
  | { outcome: "sent"; events: unknown[] }
  | { outcome: "rejected"; issues: ValidationIssue[] }
  | { outcome: "failed"; message: string }
  | { outcome: "unreachable"; reason: string };

class SendTimeout extends Error {}

interface Answer {
  status: number;
  statusText: string;
  body: string;
}

function postJson(url: URL, json: string): Promise<Answer> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(json) } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", body }));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new SendTimeout()), SEND_TIMEOUT_MS);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(json);
  });
}

function parseBody(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function send(appUrl: string, input: unknown): Promise<Sent> {
  const url = new URL(`${appUrl.replace(/\/+$/, "")}/api/events`);
  let answer: Answer;
  try {
    answer = await postJson(url, JSON.stringify(input));
  } catch (error) {
    const reason =
      error instanceof SendTimeout ? `no answer within ${SEND_TIMEOUT_MS / 1000}s` : ((error as NodeJS.ErrnoException).code ?? (error as Error).message);
    return { outcome: "unreachable", reason };
  }
  const body = parseBody(answer.body);
  const count = Array.isArray(input) ? input.length : 1;
  if (answer.status === 201 && Array.isArray(body?.events) && body.events.length === count) {
    return { outcome: "sent", events: body.events };
  }
  if (answer.status === 400 && Array.isArray(body?.issues)) return { outcome: "rejected", issues: body.issues };
  return { outcome: "failed", message: `${url} answered ${answer.status} ${answer.statusText}; ${count === 1 ? "event" : "events"} not logged` };
}

async function readEventArg(io: Io, arg: string): Promise<{ input: unknown } | undefined> {
  const source = arg === "-" ? await (io.readStdin ?? (() => text(process.stdin)))() : arg;
  try {
    return { input: JSON.parse(source) };
  } catch (error) {
    io.stderr(formatIssue({ file: "event", path: "", message: `Invalid JSON: ${(error as Error).message}` }));
    return undefined;
  }
}

async function log(io: Io, arg: string | undefined): Promise<number> {
  if (arg === undefined) {
    io.stderr(USAGE);
    return 2;
  }
  const read = await readEventArg(io, arg);
  if (!read) return 1;

  let appUrl: string | undefined;
  try {
    appUrl = await findAppUrl(io.env);
  } catch (error) {
    if (!(error instanceof GlobalConfigError)) throw error;
    io.stderr(error.message);
    return 2;
  }

  let notice = NO_APP_URL;
  if (appUrl) {
    const sent = await send(appUrl, read.input);
    if (sent.outcome === "sent") {
      io.stdout(JSON.stringify(sent.events[0]));
      return 0;
    }
    if (sent.outcome === "rejected") {
      for (const issue of sent.issues) io.stderr(formatIssue(issue));
      return 1;
    }
    if (sent.outcome === "failed") {
      io.stderr(sent.message);
      return 1;
    }
    notice = `Could not reach the app at ${appUrl} (${sent.reason})`;
  }

  const root = await findRoot(io);
  if (!root) return 2;
  try {
    const home = await loadLearningHome(root);
    const { event, file } = await appendEvent(home, read.input, { target: { machine: io.machine ?? hostname() } });
    io.stdout(JSON.stringify(event));
    io.stderr(`${notice}; wrote the event to ${join(root, file)} instead.`);
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

async function serve(io: Io, args: string[]): Promise<number> {
  const listen = listenOptions(args, io.env);
  if (typeof listen === "string") {
    io.stderr(listen);
    io.stderr(USAGE);
    return 2;
  }
  const root = await findRoot(io);
  if (!root) return 2;
  return serveHome(io, root, listen);
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function statsLines(result: Stats, subject: string | undefined): string[] {
  const range = result.from === null ? `up to ${result.to}` : `${result.from} to ${result.to}`;
  const { total, correct, wrong, skipped } = result.attempts;
  const { days, restDaysLeft } = result.streak;
  const row = (label: string, value: string) => `${label.padEnd(15)}${value}`;
  return [
    `${subject ?? "All subjects"}, ${range} (${result.timezone})`,
    row("Sessions", String(result.sessions)),
    row("Time", duration(result.durationMs)),
    row("Attempts", `${total}: ${correct} correct, ${wrong} wrong, ${skipped} skipped`),
    row("Accuracy", result.accuracy === null ? "none" : `${Math.round(result.accuracy * 100)}%`),
    row("Activity days", String(result.activityDays)),
    row("Streak", plural(days, "day") + (restDaysLeft > 0 ? `, ${plural(restDaysLeft, "rest day")} left this week` : "")),
  ];
}

async function stats(io: Io, args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { from: { type: "string" }, to: { type: "string" }, json: { type: "boolean" } },
    });
  } catch (error) {
    io.stderr((error as Error).message);
    io.stderr(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    io.stderr(USAGE);
    return 2;
  }
  const subject = positionals[0];
  const root = await findRoot(io);
  if (!root) return 2;

  let result: Stats;
  try {
    result = await readStats(await loadLearningHome(root), { subject, from: values.from, to: values.to });
  } catch (error) {
    if (error instanceof SubjectNotFoundError || error instanceof RangeError) {
      io.stderr(error.message);
      return 2;
    }
    if (error instanceof InvalidLearningHomeError || error instanceof UnsupportedFormatVersionError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
  if (values.json) io.stdout(JSON.stringify(result, null, 2));
  else for (const line of statsLines(result, subject)) io.stdout(line);
  return 0;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function describeQuery(result: QueryResult): string {
  const shown = result.value === null ? "none" : formatNumber(result.value);
  const unit = result.unit && result.value !== null && result.agg !== "count" ? ` ${result.unit}` : "";
  const noun = result.kind === "attempt" ? "attempt" : "event";
  const context = [
    `${result.count} ${noun}${result.count === 1 ? "" : "s"}`,
    ...Object.entries(result.where).map(([key, value]) => `${key}=${value}`),
    ...(result.from ? [`from ${result.from}`] : []),
    ...(result.to ? [`to ${result.to}`] : []),
  ];
  return `${result.agg} ${result.field}: ${shown}${unit} (${context.join(", ")})`;
}

async function query(io: Io, args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        field: { type: "string" },
        agg: { type: "string" },
        where: { type: "string", multiple: true },
        from: { type: "string" },
        to: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr((error as Error).message);
    io.stderr(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  const [subject] = positionals;
  if (positionals.length !== 1 || !subject || values.field === undefined || values.agg === undefined) {
    io.stderr(USAGE);
    return 2;
  }
  const where: Record<string, string> = {};
  for (const filter of values.where ?? []) {
    const at = filter.indexOf("=");
    if (at <= 0) {
      io.stderr(`--where takes field=value, such as ref=item:letter-k, not "${filter}"`);
      return 2;
    }
    where[filter.slice(0, at)] = filter.slice(at + 1);
  }

  const root = await findRoot(io);
  if (!root) return 2;
  let result: QueryResult;
  try {
    const home = await loadLearningHome(root);
    result = await queryPayload(home, subject, {
      field: values.field,
      agg: values.agg as Aggregate,
      where,
      from: values.from,
      to: values.to,
    });
  } catch (error) {
    if (error instanceof QueryError || error instanceof SubjectNotFoundError) {
      io.stderr(error.message);
      return 2;
    }
    if (error instanceof InvalidLearningHomeError || error instanceof UnsupportedFormatVersionError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
  io.stdout(values.json ? JSON.stringify(result) : describeQuery(result));
  return 0;
}

async function service(io: Io, [action, ...args]: string[]): Promise<number> {
  const serviceIo = { ...io, host: serviceHost(io.service) };
  if (action === "install") {
    const listen = listenOptions(args, io.env);
    if (typeof listen === "string") {
      io.stderr(listen);
      io.stderr(USAGE);
      return 2;
    }
    const root = await findRoot(io);
    if (!root) return 2;
    return installService(serviceIo, { root, ...listen });
  }
  if (action === "uninstall" && args.length === 0) return uninstallService(serviceIo);
  if (action === "status" && (args.length === 0 || (args.length === 1 && args[0] === "--json"))) {
    return serviceStatus(serviceIo, args[0] === "--json");
  }
  io.stderr(USAGE);
  return 2;
}

export async function run(args: string[], io: Io): Promise<number> {
  const [command, ...rest] = args;
  if (command === "init") return init(io, rest, USAGE);
  if (command === "validate") return validate(io);
  if (command === "log") return log(io, rest[0]);
  if (command === "serve") return serve(io, rest);
  if (command === "due") return due(io, rest);
  if (command === "stats") return stats(io, rest);
  if (command === "query") return query(io, rest);
  if (command === "service") return service(io, rest);
  if (command === "import") return importWorkspace(io, rest);
  if (command === "theme") return themeCheck(io, rest, USAGE);
  io.stderr(USAGE);
  return 2;
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    prompt: process.stdin.isTTY ? { input: process.stdin, output: process.stdout, terminal: true } : undefined,
  });
}
