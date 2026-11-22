import { cp, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  appendEvents,
  findAppUrl,
  formatIssue,
  GlobalConfigError,
  InvalidEventError,
  InvalidLearningHomeError,
  loadLearningHome,
  UnsupportedFormatVersionError,
  type ValidationIssue,
} from "@tomewise/core";
import { findRoot, type Io, NO_APP_URL, send, USAGE } from "./main.ts";

const WORKSPACE_ENTRIES = [
  "MISSION.md",
  "RESOURCES.md",
  "GLOSSARY.md",
  "NOTES.md",
  "learning-records",
  "lessons",
  "reference",
  "assets",
];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const APP_LOAD_TIMEOUT_MS = 5000;
const APP_LOAD_POLL_MS = 100;

interface ImportArgs {
  dir: string;
  slug?: string;
  name?: string;
}

function parseImportArgs(args: string[]): ImportArgs | string {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { slug: { type: "string" }, name: { type: "string" } },
    });
    if (positionals.length !== 1) return positionals.length === 0 ? "" : `Import one directory at a time, not ${positionals.length}`;
    return { dir: positionals[0]!, slug: values.slug, name: values.name };
  } catch (error) {
    return (error as Error).message;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function slugFrom(dir: string): string {
  return basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function missionTitle(dir: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(dir, "MISSION.md"), "utf8");
  } catch {
    return undefined;
  }
  const heading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text)?.[1];
  const title = heading?.replace(/^Mission:\s*/i, "").trim();
  return title || undefined;
}

async function filesIn(dir: string, extension: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function notLoadedYet(issues: ValidationIssue[], slug: string): boolean {
  return issues.every(
    (issue) =>
      (issue.path === "subject" && issue.message.startsWith(`No subject "${slug}"`)) ||
      (issue.path === "ref" && issue.message.startsWith("No lesson")),
  );
}

type Delivered = { ok: true; notice?: string } | { ok: false };

async function deliver(io: Io, root: string, slug: string, appUrl: string | undefined, events: unknown[]): Promise<Delivered> {
  let notice = NO_APP_URL;
  if (appUrl) {
    const deadline = Date.now() + APP_LOAD_TIMEOUT_MS;
    for (;;) {
      const sent = await send(appUrl, events);
      if (sent.outcome === "sent") return { ok: true };
      if (sent.outcome === "failed") {
        io.stderr(sent.message);
        return { ok: false };
      }
      if (sent.outcome === "unreachable") {
        notice = `Could not reach the app at ${appUrl} (${sent.reason})`;
        break;
      }
      if (!notLoadedYet(sent.issues, slug)) {
        for (const issue of sent.issues) io.stderr(formatIssue(issue));
        return { ok: false };
      }
      if (Date.now() >= deadline) {
        notice = `The app at ${appUrl} did not pick up subject "${slug}" within ${APP_LOAD_TIMEOUT_MS / 1000}s; is it serving another learning home?`;
        break;
      }
      await sleep(APP_LOAD_POLL_MS);
    }
  }

  try {
    const home = await loadLearningHome(root);
    const appended = await appendEvents(home, events, { target: { machine: io.machine ?? hostname() } });
    const files = [...new Set(appended.map(({ file }) => join(root, file)))];
    return { ok: true, notice: `${notice}; wrote the events to ${files.join(", ")} instead.` };
  } catch (error) {
    if (error instanceof InvalidEventError) {
      for (const issue of error.issues) io.stderr(formatIssue(issue));
      return { ok: false };
    }
    throw error;
  }
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

function checklist(subjectDir: string, name: string, lessons: string[], scripts: string[]): string[] {
  const summary =
    lessons.length > 0
      ? `Imported ${plural(lessons.length, "lesson")} into ${subjectDir} (${name}), all marked complete.`
      : `Imported ${subjectDir} (${name}); it has no lessons to mark complete.`;
  return [
    summary,
    "",
    "Still to do, for your agent:",
    `- [ ] Convert the drills into widgets that follow the event contract: built-in widgets for generic drills, subject widgets in ${subjectDir}/assets/ for the rest.`,
    ...(scripts.length > 0 ? [`      Scripts to look at: ${scripts.map((script) => `assets/${script}`).join(", ")}`] : []),
    `- [ ] Write items for what each lesson teaches in ${subjectDir}/items/, and a payload schema for their attempts in ${subjectDir}/subject.json.`,
    `- [ ] Rewrite the lessons in ${subjectDir}/lessons/ to use the widgets.`,
    "",
    "Practice history kept in the browser (localStorage) was not imported; learning-records/ and NOTES.md carry what was learned.",
  ];
}

export async function importWorkspace(io: Io, args: string[]): Promise<number> {
  const parsed = parseImportArgs(args);
  if (typeof parsed === "string") {
    if (parsed) io.stderr(parsed);
    io.stderr(USAGE);
    return 2;
  }

  const dir = resolve(io.cwd, parsed.dir);
  if (!(await isDirectory(dir))) {
    io.stderr(`No directory ${dir}`);
    return 1;
  }
  const present: string[] = [];
  for (const entry of WORKSPACE_ENTRIES) if (await exists(join(dir, entry))) present.push(entry);
  if (!present.includes("MISSION.md") && !present.includes("lessons")) {
    io.stderr(`${dir} isn't a teach workspace: it has no MISSION.md or lessons/`);
    return 1;
  }

  const slug = parsed.slug ?? slugFrom(dir);
  if (!SLUG.test(slug)) {
    io.stderr(
      parsed.slug === undefined
        ? `Cannot make a subject slug from "${basename(dir)}"; pass one with --slug, such as --slug morse-code`
        : `--slug must be lowercase letters and digits joined by dashes, such as morse-code, not "${slug}"`,
    );
    return 2;
  }
  const name = parsed.name ?? (await missionTitle(dir)) ?? slug;

  const root = await findRoot(io);
  if (!root) return 2;
  try {
    await loadLearningHome(root);
  } catch (error) {
    if (error instanceof InvalidLearningHomeError || error instanceof UnsupportedFormatVersionError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }

  let appUrl: string | undefined;
  try {
    appUrl = await findAppUrl(io.env);
  } catch (error) {
    if (!(error instanceof GlobalConfigError)) throw error;
    io.stderr(error.message);
    return 2;
  }

  const subjectDir = `subjects/${slug}`;
  const dest = join(root, subjectDir);
  if (await exists(dest)) {
    io.stderr(`${subjectDir} already exists in ${root}; pick another slug with --slug`);
    return 1;
  }

  const staging = await mkdtemp(join(root, `.import-${slug}-`));
  let placed = false;
  try {
    for (const entry of present) await cp(join(dir, entry), join(staging, entry), { recursive: true });
    await writeFile(join(staging, "subject.json"), `${JSON.stringify({ name }, null, 2)}\n`);
    await rename(staging, dest);
    placed = true;

    const lessons = (await filesIn(join(dest, "lessons"), ".html")).map((file) => file.slice(0, -".html".length));
    const events = lessons.map((lesson) => ({
      subject: slug,
      kind: "lesson.completed",
      ref: `lesson:${lesson}`,
      schemaVersion: 1,
      data: {},
    }));
    if (events.length > 0) {
      const delivered = await deliver(io, root, slug, appUrl, events);
      if (!delivered.ok) {
        await rm(dest, { recursive: true, force: true });
        io.stderr(`Nothing imported; removed ${subjectDir}.`);
        return 1;
      }
      if (delivered.notice) io.stderr(delivered.notice);
    }

    for (const line of checklist(subjectDir, name, lessons, await filesIn(join(dest, "assets"), ".js"))) io.stdout(line);
    return 0;
  } catch (error) {
    if (placed) await rm(dest, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
