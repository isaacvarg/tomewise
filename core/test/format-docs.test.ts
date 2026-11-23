import { cp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateLearningHome, type ValidationIssue } from "@tomewise/core";
import { tempDir, writeFiles } from "./helpers.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const DOCS_DIR = "skill/skills/teach";
const FORMAT_DOCS = [
  "EVENTS-FORMAT.md",
  "SUBJECT-FORMAT.md",
  "ITEMS-FORMAT.md",
  "DRILLS-FORMAT.md",
  "CURRICULUM-FORMAT.md",
  "ASSESSMENTS-FORMAT.md",
];
const REPO_LINK = /\]\(https:\/\/github\.com\/isaacvarg\/tomewise\/blob\/main\/([^)#\s]+)\)/g;
const VALIDATED = [
  /^tomewise\.json$/,
  /^subjects\/[^/]+\/(?:subject|curriculum)\.json$/,
  /^subjects\/[^/]+\/(?:items|drills)\/[^/]+\.json$/,
  /^subjects\/[^/]+\/events\/[^/]+\.jsonl$/,
  /^subjects\/[^/]+\/(?:lessons|quizzes|exams)\/[^/]+\.html$/,
];

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function formatDocProblems(repo: string, docs: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  const validated = new Map<string, Promise<ValidationIssue[]>>();
  for (const doc of docs) {
    const text = await readFile(join(repo, DOCS_DIR, doc), "utf8");
    const links = [...new Set([...text.matchAll(REPO_LINK)].map((match) => match[1]!))];
    if (!links.some((link) => link.startsWith("examples/"))) problems.push(`${doc} links no worked example in examples/`);
    if (!links.some((link) => link.startsWith("schemas/"))) problems.push(`${doc} links no JSON Schema in schemas/`);
    for (const link of links) {
      if (!(await exists(join(repo, link)))) {
        problems.push(`${doc} links ${link}, which does not exist`);
        continue;
      }
      const example = /^(examples\/[^/]+)\/(.+)$/.exec(link);
      if (!example) continue;
      const [, home, file] = example as unknown as [string, string, string];
      if (!VALIDATED.some((pattern) => pattern.test(file))) {
        problems.push(`${doc} links ${link}, which tome validate does not check`);
        continue;
      }
      let issues = validated.get(home);
      if (!issues) {
        issues = validateLearningHome(join(repo, home));
        validated.set(home, issues);
      }
      for (const issue of await issues) {
        if (issue.file === file) problems.push(`${doc} links ${link}, which fails tome validate: ${issue.path} ${issue.message}`);
      }
    }
  }
  return problems;
}

const link = (path: string) => `[${path}](https://github.com/isaacvarg/tomewise/blob/main/${path})`;
const SCHEMA = "schemas/v1/drill.json";
const DRILL = "examples/morse/subjects/morse-code/drills/listen-kmrsu.json";

async function repoWithDoc(body: string): Promise<string> {
  const repo = await tempDir();
  await cp(join(REPO, "examples/morse"), join(repo, "examples/morse"), { recursive: true });
  await cp(join(REPO, "schemas"), join(repo, "schemas"), { recursive: true });
  await writeFiles(repo, { [`${DOCS_DIR}/DRILLS-FORMAT.md`]: body });
  return repo;
}

describe("the teach skill's format docs", () => {
  it("link worked examples that exist and pass tome validate, and the JSON Schemas", async () => {
    expect(await formatDocProblems(REPO, FORMAT_DOCS)).toEqual([]);
  });

  it("are flagged for an example file that does not exist", async () => {
    const missing = "examples/morse/subjects/morse-code/drills/missing.json";
    const repo = await repoWithDoc(`${link(missing)} ${link(SCHEMA)}`);

    expect(await formatDocProblems(repo, ["DRILLS-FORMAT.md"])).toEqual([`DRILLS-FORMAT.md links ${missing}, which does not exist`]);
  });

  it("are flagged for an example file that fails tome validate", async () => {
    const repo = await repoWithDoc(`${link(DRILL)} ${link(SCHEMA)}`);
    await writeFile(join(repo, DRILL), JSON.stringify({ name: "Listen", select: { from: "sometimes" } }));

    const problems = await formatDocProblems(repo, ["DRILLS-FORMAT.md"]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(`DRILLS-FORMAT.md links ${DRILL}, which fails tome validate: select.from`);
  });

  it("are flagged for an example file tome validate never reads", async () => {
    const notes = "examples/morse/NOTES.md";
    const repo = await repoWithDoc(`${link(notes)} ${link(SCHEMA)}`);
    await writeFiles(repo, { [notes]: "notes" });

    expect(await formatDocProblems(repo, ["DRILLS-FORMAT.md"])).toEqual([`DRILLS-FORMAT.md links ${notes}, which tome validate does not check`]);
  });

  it("are flagged when one links no example or no schema", async () => {
    const repo = await repoWithDoc("No links here.");

    expect(await formatDocProblems(repo, ["DRILLS-FORMAT.md"])).toEqual([
      "DRILLS-FORMAT.md links no worked example in examples/",
      "DRILLS-FORMAT.md links no JSON Schema in schemas/",
    ]);
  });
});
