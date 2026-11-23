import { DEFAULT_APP_URL } from "@tomewise/core";
import type { Io } from "./main.ts";
import { listenOptions, serveHome, type Listen } from "./serve.ts";
import { installService, serviceHost } from "./service.ts";

export const APP_CHOICES = ["now", "service", "docker", "none"] as const;
export type AppChoice = (typeof APP_CHOICES)[number];

export function isAppChoice(value: string): value is AppChoice {
  return (APP_CHOICES as readonly string[]).includes(value);
}

const CONTAINER_PORT = 4777;

export function listenFor(io: Io, appUrl: string | undefined): Listen | string {
  const { port } = new URL(appUrl ?? DEFAULT_APP_URL);
  return listenOptions(port ? ["--port", port] : [], io.env);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function printSkillInstall(io: Io): void {
  io.stdout("");
  io.stdout("Install the Tomewise skill so your agent knows the format. It isn't published as a plugin yet; until it is,");
  io.stdout("copy the skill/skills/teach/ folder of https://github.com/isaacvarg/tomewise into your agent's skills folder,");
  io.stdout("such as ~/.claude/skills/teach for Claude Code.");
}

function printFirstSubject(io: Io, root: string, subject: string | undefined): void {
  io.stdout("");
  io.stdout("Give your agent this message to create your first subject:");
  io.stdout(`  /teach Set up a new subject in ${root}${subject ? `: ${subject}` : "."}`);
}

function printDocker(io: Io, root: string, listen: Listen): void {
  io.stdout("");
  io.stdout("To run the app in a container, build the image from a checkout of the tomewise repository:");
  io.stdout("  docker build -t tomewise .");
  io.stdout("Then run it with the learning home mounted:");
  io.stdout(
    `  docker run -d --name tomewise -p ${listen.host}:${listen.port}:${CONTAINER_PORT} -v ${shellQuote(root)}:/learning-home tomewise`,
  );
}

export interface Launch {
  app: Exclude<AppChoice, "none">;
  listen: Listen;
}

export interface Handoff {
  root: string;
  subject: string | false | undefined;
  launch?: Launch;
}

export async function handOff(io: Io, { root, subject, launch }: Handoff): Promise<number> {
  printSkillInstall(io);
  if (subject !== false) printFirstSubject(io, root, subject);
  if (!launch) return 0;
  const { app, listen } = launch;
  if (app === "docker") {
    printDocker(io, root, listen);
    return 0;
  }
  io.stdout("");
  if (app === "service") return installService({ ...io, host: serviceHost(io.service) }, { root, ...listen });
  return serveHome(io, root, listen);
}
