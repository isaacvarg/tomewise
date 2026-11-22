import { parseArgs } from "node:util";
import {
  dueItems,
  InvalidLearningHomeError,
  loadLearningHome,
  SubjectNotFoundError,
  UnsupportedFormatVersionError,
  type DueItem,
} from "@tomewise/core";
import { findRoot, USAGE, type Io } from "./main.ts";

interface DueOptions {
  subject?: string;
  date?: string;
  json: boolean;
}

function parse(args: string[]): DueOptions | string {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { date: { type: "string" }, json: { type: "boolean", default: false } },
    });
    if (positionals.length > 1) return `Unexpected argument "${positionals[1]}"`;
    return { subject: positionals[0], date: values.date, json: values.json };
  } catch (error) {
    return (error as Error).message;
  }
}

function isDay(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return day.toISOString().slice(0, 10) === date;
}

function dayIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(instant);
}

function human(date: string, timezone: string, groups: [string, DueItem[]][]): string[] {
  const total = groups.reduce((sum, [, items]) => sum + items.length, 0);
  if (total === 0) return [`Nothing due on ${date}`];
  const lines = [`Due on ${date}: ${total} ${total === 1 ? "item" : "items"}`];
  for (const [subject, items] of groups) {
    if (items.length === 0) continue;
    const width = Math.max(...items.map(({ item }) => item.id.length));
    lines.push("", `${subject} (${items.length})`);
    for (const { item, due } of items) {
      lines.push(`  ${item.id.padEnd(width)}  ${due === null ? "new" : `due ${dayIn(new Date(due), timezone)}`}`);
    }
  }
  return lines;
}

export async function due(io: Io, args: string[]): Promise<number> {
  const options = parse(args);
  if (typeof options === "string") {
    io.stderr(options);
    io.stderr(USAGE);
    return 2;
  }
  if (options.date !== undefined && !isDay(options.date)) {
    io.stderr(`--date must be a day as YYYY-MM-DD, not "${options.date}"`);
    return 2;
  }
  const root = await findRoot(io);
  if (!root) return 2;

  try {
    const home = await loadLearningHome(root);
    const { timezone } = home.config;
    const date = options.date ?? dayIn(new Date(), timezone);
    const subjects = options.subject === undefined ? home.subjects : [options.subject];
    const groups: [string, DueItem[]][] = [];
    for (const subject of subjects) groups.push([subject, await dueItems(home, subject, date)]);

    if (options.json) {
      const items = groups.flatMap(([subject, list]) => list.map(({ item, due }) => ({ subject, due, item })));
      io.stdout(JSON.stringify({ date, timezone, items }, null, 2));
    } else {
      for (const line of human(date, timezone, groups)) io.stdout(line);
    }
    return 0;
  } catch (error) {
    if (error instanceof SubjectNotFoundError) {
      io.stderr(error.message);
      return 2;
    }
    if (error instanceof InvalidLearningHomeError || error instanceof UnsupportedFormatVersionError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
}
