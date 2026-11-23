import { execFile } from "node:child_process";
import { appendFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tempDir } from "../../core/test/helpers.ts";
import { run } from "../src/main.ts";

export type Action =
  | { type: "git"; args: string[]; output: string }
  | { type: "tome"; args: string[]; code: number; stdout: string; stderr: string }
  | { type: "read"; path: string }
  | { type: "write"; path: string };

export interface TomeResult {
  code: number;
  stdout: string;
  stderr: string;
  json<T = any>(): T;
}

export interface Upstream {
  message: string;
  append?: Record<string, string>;
  write?: Record<string, string>;
  remove?: string[];
}

export interface ScenarioOptions {
  example?: string;
  upstream?: Upstream[];
}

export interface Scenario {
  home: string;
  remote: string;
  actions: Action[];
  git(...args: string[]): Promise<string>;
  tome(...args: string[]): Promise<TomeResult>;
  read(path: string): Promise<string>;
  list(dir: string): Promise<string[]>;
  write(path: string, content: string): Promise<void>;
}

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Learner",
  GIT_AUTHOR_EMAIL: "learner@example.com",
  GIT_COMMITTER_NAME: "Learner",
  GIT_COMMITTER_EMAIL: "learner@example.com",
};

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: { ...process.env, ...GIT_ENV } }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args.join(" ")}: ${stderr.trim() || error.message}`));
      else resolve(stdout.trim());
    });
  });
}

async function pushUpstream(remote: string, change: Upstream): Promise<void> {
  const clone = await tempDir();
  await git(clone, ["clone", "--quiet", remote, "."]);
  for (const [path, content] of Object.entries(change.write ?? {})) {
    await mkdir(dirname(join(clone, path)), { recursive: true });
    await writeFile(join(clone, path), content);
  }
  for (const [path, content] of Object.entries(change.append ?? {})) {
    await mkdir(dirname(join(clone, path)), { recursive: true });
    await appendFile(join(clone, path), content);
  }
  for (const path of change.remove ?? []) await rm(join(clone, path));
  await git(clone, ["add", "--all"]);
  await git(clone, ["commit", "--quiet", "--message", change.message]);
  await git(clone, ["push", "--quiet", "origin", "main"]);
}

export async function startScenario(options: ScenarioOptions = {}): Promise<Scenario> {
  const remote = await tempDir();
  await git(remote, ["init", "--quiet", "--bare", "--initial-branch=main"]);

  const home = await tempDir();
  await cp(new URL(`../../examples/${options.example ?? "morse"}/`, import.meta.url), home, { recursive: true });
  await git(home, ["init", "--quiet", "--initial-branch=main"]);
  await git(home, ["remote", "add", "origin", remote]);
  await git(home, ["add", "--all"]);
  await git(home, ["commit", "--quiet", "--message", "chore(home): start learning home"]);
  await git(home, ["push", "--quiet", "--set-upstream", "origin", "main"]);

  for (const change of options.upstream ?? []) await pushUpstream(remote, change);

  const userHome = await tempDir();
  const actions: Action[] = [];

  return {
    home,
    remote,
    actions,
    async git(...args) {
      const output = await git(home, args);
      actions.push({ type: "git", args, output });
      return output;
    },
    async tome(...args) {
      const out: string[] = [];
      const err: string[] = [];
      const code = await run(args, {
        cwd: home,
        env: { HOME: userHome },
        machine: "scenario",
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      });
      const stdout = out.join("\n");
      const stderr = err.join("\n");
      actions.push({ type: "tome", args, code, stdout, stderr });
      return { code, stdout, stderr, json: () => JSON.parse(stdout) };
    },
    async read(path) {
      actions.push({ type: "read", path });
      return readFile(join(home, path), "utf8");
    },
    async list(dir) {
      actions.push({ type: "read", path: dir });
      return (await readdir(join(home, dir))).sort();
    },
    async write(path, content) {
      await mkdir(dirname(join(home, path)), { recursive: true });
      await writeFile(join(home, path), content);
      actions.push({ type: "write", path });
    },
  };
}

export function commandLine(action: Action): string {
  if (action.type === "git" || action.type === "tome") return [action.type, ...action.args].join(" ");
  return `${action.type} ${action.path}`;
}

export function position(actions: readonly Action[], prefix: string): number {
  return actions.findIndex((action) => commandLine(action).startsWith(prefix));
}

export function firstWrite(actions: readonly Action[]): number {
  return actions.findIndex((action) => action.type === "write");
}

export function written(actions: readonly Action[]): string[] {
  return actions.flatMap((action) => (action.type === "write" ? [action.path] : []));
}

export const WIDGET_TAGS = [
  "tome-flashcard",
  "tome-choice",
  "tome-typed",
  "tome-audio",
  "tome-routine",
  "tome-done",
  "tome-explain",
  "tome-exam-question",
  "tome-timer",
  "tome-drill",
] as const;

export interface Page {
  widgets: string[];
  unknownTags: string[];
  refs: string[];
  drills: string[];
  colours: string[];
}

const COLOUR_KEYWORDS =
  "black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|navy|teal|silver|gold|maroon|olive|lime|aqua|fuchsia";

export function hardCodedColours(text: string): string[] {
  const css = text.replace(/\bhref="[^"]*"/g, "");
  const literals = css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi) ?? [];
  const keywords = [...css.matchAll(new RegExp(`(?:color|background|border|fill|stroke)[\\w-]*\\s*:[^;"}]*\\b(${COLOUR_KEYWORDS})\\b`, "gi"))].map(
    (match) => match[1]!,
  );
  return [...literals, ...keywords];
}

export function readPage(html: string): Page {
  const tags = [...html.matchAll(/<(tome-[a-z-]+)\b/g)].map((match) => match[1]!);
  const known = new Set<string>(WIDGET_TAGS);
  return {
    widgets: tags.filter((tag) => known.has(tag)),
    unknownTags: tags.filter((tag) => !known.has(tag)),
    refs: [...html.matchAll(/\bref="([^"]+)"/g)].map((match) => match[1]!),
    drills: [...html.matchAll(/<tome-drill\b[^>]*\bdrill="([^"]+)"/g)].map((match) => match[1]!),
    colours: hardCodedColours(html),
  };
}
