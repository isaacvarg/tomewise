import { BUILT_SPA, startServer } from "@tomewise/app";
import { formatIssue, loadLearningHome, validateLearningHome } from "@tomewise/core";
import { parseArgs } from "node:util";
import type { Io } from "./main.ts";

export interface Listen {
  host: string;
  port: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4777;

export function listenOptions(args: string[], env: NodeJS.ProcessEnv): Listen | string {
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

export async function serveHome(io: Io, root: string, listen: Listen): Promise<number> {
  const issues = await validateLearningHome(root);
  if (issues.length > 0) {
    for (const issue of issues) io.stderr(formatIssue(issue));
    io.stderr(`Not serving ${root}: ${issues.length} ${issues.length === 1 ? "problem" : "problems"}. Run \`tome validate\` after fixing.`);
    return 1;
  }

  const home = await loadLearningHome(root);
  let server;
  try {
    server = await startServer(home, {
      ...listen,
      spa: BUILT_SPA,
      updates: io.updates,
      warn: (message) => io.stderr(message),
      watch: { onError: (error) => io.stderr(`Not reloading ${root}: ${(error as Error).message}`) },
    });
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
