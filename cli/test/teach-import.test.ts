import { readFileSync } from "node:fs";
import { cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { snapshot } from "../../core/test/helpers.ts";
import { startWidgetApp } from "../../widgets/test/browser.ts";
import { commandLine, git, position, readPage, startScenario, written, type Scenario } from "./scenario.ts";

const DOCS = new URL("../../skill/skills/teach/", import.meta.url);
const SKILL = readFileSync(new URL("SKILL.md", DOCS), "utf8");
const GUIDE = readFileSync(new URL("IMPORT-CONVERSION.md", DOCS), "utf8");
const SLUG = "hiragana";
const SUBJECT = `subjects/${SLUG}`;
const LESSONS = ["0001-the-a-row", "0002-the-ka-row"];
const ORDER = ["git pull", "git rm", "tome validate", "git add", "git commit", "git push"];
const STROKES = ["top bar with hook", "long down stroke", "short tick"];

const SUBJECT_JSON = {
  name: "Hiragana",
  payloadSchemas: [
    {
      version: 1,
      kinds: {
        attempt: {
          type: "object",
          properties: {
            mistakes: { type: "integer" },
            responseTime: { type: "integer", unit: "ms" },
          },
        },
      },
    },
  ],
};

const card = (kana: string, romaji: string, lesson: string, row: string) => ({
  id: `kana-${romaji}`,
  type: "flashcard",
  front: kana,
  back: romaji,
  unlockedBy: lesson,
  tags: ["kana", row],
});

const ITEMS: Record<string, object[]> = {
  "0001-the-a-row": [
    card("あ", "a", "0001-the-a-row", "a-row"),
    card("い", "i", "0001-the-a-row", "a-row"),
    card("う", "u", "0001-the-a-row", "a-row"),
    card("え", "e", "0001-the-a-row", "a-row"),
    card("お", "o", "0001-the-a-row", "a-row"),
  ],
  "0002-the-ka-row": [
    card("か", "ka", "0002-the-ka-row", "ka-row"),
    card("き", "ki", "0002-the-ka-row", "ka-row"),
    card("く", "ku", "0002-the-ka-row", "ka-row"),
    card("け", "ke", "0002-the-ka-row", "ka-row"),
    card("こ", "ko", "0002-the-ka-row", "ka-row"),
    {
      id: "strokes-ka",
      type: "flashcard",
      front: "Write か in stroke order",
      back: STROKES.map((stroke, i) => `${i + 1} ${stroke}`).join(" · "),
      unlockedBy: "0002-the-ka-row",
      tags: ["stroke-order"],
    },
  ],
};

const DRILL = {
  name: "Read the kana",
  select: { from: "unlocked", tags: ["kana"] },
  count: 10,
  format: "item",
};

const KANA_STROKES = `import { tome } from "/widgets/v1/tome.js";

class KanaStrokes extends HTMLElement {
  #strokes = [];
  #next = 0;
  #mistakes = 0;
  #shownAt = 0;

  connectedCallback() {
    if (this.querySelector(".kana-strokes")) return;
    this.#strokes = this.getAttribute("strokes").split("|");
    this.innerHTML = \`
      <div class="kana-strokes tome-stage">
        <p class="tome-prompt"></p>
        <div class="kana-strokes-choices"></div>
        <div class="tome-feedback" aria-live="polite"></div>
      </div>\`;
    this.querySelector(".tome-prompt").textContent = \`Tap the strokes of \${this.getAttribute("kana")} in order.\`;
    const choices = this.querySelector(".kana-strokes-choices");
    for (const stroke of [...this.#strokes].sort(() => Math.random() - 0.5)) {
      const button = document.createElement("button");
      button.className = "tome-answer";
      button.textContent = stroke;
      button.addEventListener("click", () => void this.#tap(button, stroke));
      choices.append(button);
    }
    this.#shownAt = performance.now();
  }

  async #tap(button, stroke) {
    if (stroke !== this.#strokes[this.#next]) {
      this.#mistakes++;
      button.dataset.state = "wrong";
      return;
    }
    this.#next++;
    button.dataset.state = "correct";
    button.disabled = true;
    if (this.#next < this.#strokes.length) return;
    const responseTime = Math.round(performance.now() - this.#shownAt);
    const correct = this.#mistakes === 0;
    const saved = await tome
      .attempt(
        {
          ref: this.getAttribute("ref"),
          outcome: correct ? "correct" : "wrong",
          grade: correct ? 3 : 1,
          duration: responseTime,
          data: { mistakes: this.#mistakes, responseTime },
        },
        this,
      )
      .catch(() => undefined);
    if (!saved) return;
    this.querySelector(".tome-feedback").innerHTML = \`<p class="tome-verdict" data-state="\${correct ? "correct" : "wrong"}"></p>\`;
    this.querySelector(".tome-verdict").textContent = correct ? "Right order" : \`In order: \${this.#strokes.join(", ")}\`;
  }
}

customElements.define("kana-strokes", KanaStrokes);
`;

const STYLE = `<style>
.tome-tip { background: var(--t-surface); border-left: 4px solid var(--t-accent); padding: .5rem 1rem; }
.kana-strokes-choices { display: flex; gap: .5rem; }
</style>`;

const page = (title: string, head: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
${head}</head>
<body>
<h1>${title}</h1>
${body}
</body>
</html>
`;

const flashcards = (lesson: string) =>
  (ITEMS[lesson] as { id: string; tags: string[] }[])
    .filter((item) => item.tags.includes("kana"))
    .map((item) => `<tome-flashcard ref="item:${item.id}"></tome-flashcard>`)
    .join("\n");

const CONVERTED: Record<string, string> = {
  "lessons/0001-the-a-row.html": page(
    "The a row",
    "",
    `<p>Five vowels start the chart: あ a, い i, う u, え e, お o. <a href="https://www.tofugu.com/japanese/learn-hiragana/">Tofugu's mnemonics</a> give each one a picture.</p>
${flashcards("0001-the-a-row")}
<p><a href="../reference/kana-chart.html">Kana chart</a> · Ask me anything that's unclear.</p>
<tome-done></tome-done>`,
  ),
  "lessons/0002-the-ka-row.html": page(
    "The ka row",
    `${STYLE}\n<script type="module" src="../assets/kana-strokes.js"></script>\n`,
    `<p class="tome-tip">Add k to each vowel: か ka, き ki, く ku, け ke, こ ko.</p>
${flashcards("0002-the-ka-row")}
<h2>Write か</h2>
<p>Watch the <a href="https://www3.nhk.or.jp/nhkworld/lesson/en/letters/hiragana.html">NHK stroke animation</a> first.</p>
<kana-strokes ref="item:strokes-ka" kana="か" strokes="${STROKES.join("|")}"></kana-strokes>
<tome-drill drill="read-kana"></tome-drill>
<p><a href="./0001-the-a-row.html">The a row</a> · <a href="../reference/kana-chart.html">Kana chart</a> · Ask me anything that's unclear.</p>
<tome-done></tome-done>`,
  ),
  "reference/kana-chart.html": page(
    "Kana chart",
    "<style>\n.tome-chart td { border-bottom: 1px solid var(--t-rule); padding: .25rem .75rem; font-family: var(--t-display); }\n</style>\n",
    `<table class="tome-chart">
<tr><td>あ a</td><td>い i</td><td>う u</td><td>え e</td><td>お o</td><td><a href="../lessons/0001-the-a-row.html">Lesson 1</a></td></tr>
<tr><td>か ka</td><td>き ki</td><td>く ku</td><td>け ke</td><td>こ ko</td><td><a href="../lessons/0002-the-ka-row.html">Lesson 2</a></td></tr>
</table>`,
  ),
};

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

async function convertImport(session: Scenario) {
  await session.git("pull", "--quiet");
  for (const dir of ["lessons", "reference", "assets", "learning-records"]) {
    for (const file of await session.list(`${SUBJECT}/${dir}`)) await session.read(`${SUBJECT}/${dir}/${file}`);
  }
  await session.read(`${SUBJECT}/NOTES.md`);

  await session.write(`${SUBJECT}/subject.json`, json(SUBJECT_JSON));
  for (const [lesson, items] of Object.entries(ITEMS)) await session.write(`${SUBJECT}/items/${lesson}.json`, json(items));
  await session.write(`${SUBJECT}/drills/read-kana.json`, json(DRILL));
  await session.write(`${SUBJECT}/assets/kana-strokes.js`, KANA_STROKES);
  for (const [path, html] of Object.entries(CONVERTED)) await session.write(`${SUBJECT}/${path}`, html);
  await session.git("rm", "--quiet", `${SUBJECT}/assets/flashcards.js`, `${SUBJECT}/assets/stroke-order.js`, `${SUBJECT}/assets/style.css`);

  const validate = await session.tome("validate");
  expect(validate.stderr).toBe("");

  await session.git("add", SUBJECT);
  await session.git("commit", "--message", `feat(${SLUG}): convert imported workspace to widgets`);
  await session.git("push", "--quiet");
}

describe("skill/skills/teach/IMPORT-CONVERSION.md", () => {
  it("is linked from SKILL.md", () => {
    expect(SKILL).toContain("[IMPORT-CONVERSION.md](./IMPORT-CONVERSION.md)");
  });

  it("points at the widget and format docs", () => {
    for (const doc of ["WIDGETS.md", "ITEMS-FORMAT.md", "SUBJECT-FORMAT.md", "DRILLS-FORMAT.md"]) {
      expect(GUIDE).toContain(`(./${doc})`);
      expect(readFileSync(new URL(doc, DOCS), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("lists the commands in the order the scenario runs them", () => {
    const at = ORDER.map((command) => GUIDE.indexOf(command));
    expect(at.every((index) => index > -1), ORDER.filter((_, i) => at[i] === -1).join(", ")).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe("teach scenario: convert an imported workspace", () => {
  let session: Scenario;
  let imported: Record<string, string>;
  let converted: Record<string, string>;

  beforeAll(async () => {
    session = await startScenario({
      home: new URL("fixtures/new-home/", import.meta.url),
      imports: [{ dir: new URL("fixtures/teach-hiragana/", import.meta.url), slug: SLUG }],
    });
    imported = await snapshot(join(session.home, SUBJECT));
    await convertImport(session);
    converted = await snapshot(join(session.home, SUBJECT));
  });

  const pages = () => Object.entries(converted).filter(([path]) => path.endsWith(".html"));

  it("starts from what tome import left: drills in scripts, every lesson complete", () => {
    expect(JSON.parse(imported["subject.json"]!)).toEqual({ name: "Hiragana" });
    expect(Object.keys(imported).filter((path) => path.startsWith("assets/"))).toEqual([
      "assets/flashcards.js",
      "assets/stroke-order.js",
      "assets/style.css",
    ]);
    const events = Object.entries(imported)
      .filter(([path]) => path.startsWith("events/"))
      .flatMap(([, text]) => text.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
    expect(events.map((event) => event.ref)).toEqual(LESSONS.map((lesson) => `lesson:${lesson}`));
  });

  it("follows the guide's command order", () => {
    const commands = session.actions.filter((action) => action.type === "git" || action.type === "tome").map(commandLine);
    const at = ORDER.map((prefix) => commands.findIndex((command) => command.startsWith(prefix)));
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("reads every imported page and script before writing", () => {
    const firstWrite = session.actions.findIndex((action) => action.type === "write");
    const read = new Set(session.actions.slice(0, firstWrite).flatMap((action) => (action.type === "read" ? [action.path] : [])));
    for (const path of Object.keys(imported).filter((path) => /^(lessons|reference|assets)\//.test(path))) {
      expect(read.has(`${SUBJECT}/${path}`), path).toBe(true);
    }
  });

  it("passes tome validate before committing", () => {
    const validate = session.actions.find((action) => action.type === "tome" && action.args[0] === "validate");
    expect(validate?.type === "tome" && validate.code).toBe(0);
    expect(validate?.type === "tome" && validate.stdout).toMatch(/is valid\.$/);
    expect(position(session.actions, "tome validate")).toBeLessThan(position(session.actions, "git commit"));
    expect(position(session.actions, "tome validate")).toBeGreaterThan(session.actions.findLastIndex((action) => action.type === "write"));
  });

  it("keeps the imported lessons' names and history", () => {
    expect(Object.keys(converted).filter((path) => path.startsWith("lessons/"))).toEqual(LESSONS.map((lesson) => `lessons/${lesson}.html`));
    for (const [path, text] of Object.entries(imported)) if (path.startsWith("events/")) expect(converted[path]).toBe(text);
    expect(written(session.actions).filter((path) => path.includes("/events/"))).toEqual([]);
  });

  it("turns the generic flashcard drill into built-in flashcards", () => {
    const old = [...imported["lessons/0001-the-a-row.html"]!.matchAll(/data-cards="([^"]+)"/g)]
      .flatMap((match) => match[1]!.split(","))
      .map((pair) => `item:kana-${pair.split(":")[1]}`);
    const shown = readPage(converted["lessons/0001-the-a-row.html"]!);
    expect(shown.widgets.filter((tag) => tag === "tome-flashcard")).toHaveLength(old.length);
    expect(shown.refs).toEqual(old);
    expect(converted["assets/flashcards.js"]).toBeUndefined();
  });

  it("turns the subject-specific stroke drill into a custom widget in assets/ that follows the event contract", () => {
    const widget = converted["assets/kana-strokes.js"]!;
    expect(widget).toContain('import { tome } from "/widgets/v1/tome.js";');
    expect(widget).toMatch(/customElements\.define\("kana-strokes"/);
    expect(widget).toMatch(/tome\s*\.attempt\(/);
    expect(widget).not.toMatch(/attachShadow|localStorage/);
    expect(converted["assets/stroke-order.js"]).toBeUndefined();

    const recorded = [...widget.matchAll(/data: \{ ([^}]+) \}/g)].flatMap((match) => match[1]!.split(",").map((field) => field.trim().split(":")[0]!));
    const attempt = JSON.parse(converted["subject.json"]!).payloadSchemas.at(-1).kinds.attempt;
    expect(recorded.length).toBeGreaterThan(0);
    for (const field of recorded) expect(Object.keys(attempt.properties)).toContain(field);
    expect(attempt.required ?? []).toEqual([]);

    const lesson = converted["lessons/0002-the-ka-row.html"]!;
    expect(lesson).toContain('<script type="module" src="../assets/kana-strokes.js"></script>');
    expect(lesson).toMatch(/<kana-strokes ref="item:strokes-ka"/);
  });

  it("unlocks every item a converted lesson shows by that lesson", () => {
    for (const lesson of LESSONS) {
      const items: { id: string; unlockedBy: string }[] = JSON.parse(converted[`items/${lesson}.json`]!);
      const shown = readPage(converted[`lessons/${lesson}.html`]!).refs.map((ref) => ref.slice("item:".length));
      for (const id of shown) expect(items.find((item) => item.id === id)?.unlockedBy, id).toBe(lesson);
    }
  });

  it("ends every lesson with tome-done and runs a drill that draws the converted items", () => {
    for (const lesson of LESSONS) expect(readPage(converted[`lessons/${lesson}.html`]!).widgets.at(-1)).toBe("tome-done");
    expect(readPage(converted["lessons/0002-the-ka-row.html"]!).drills).toEqual(["read-kana"]);
    const tags = new Set(Object.values(ITEMS).flat().flatMap((item) => (item as { tags: string[] }).tags));
    expect(DRILL.select.tags.every((tag) => tags.has(tag))).toBe(true);
  });

  it("builds every page from widgets and styles it only with theme tokens", () => {
    expect(pages().map(([path]) => path).sort()).toEqual(Object.keys(CONVERTED).sort());
    for (const [path, html] of pages()) {
      const shown = readPage(html);
      expect(shown.unknownTags, path).toEqual([]);
      expect(shown.colours, path).toEqual([]);
      expect(html, path).not.toMatch(/rel="stylesheet"|<script(?![^>]*type="module")/);
    }
  });

  it("leaves no localStorage anywhere in the subject", () => {
    expect(Object.values(imported).some((text) => text.includes("localStorage"))).toBe(true);
    expect(Object.entries(converted).filter(([, text]) => text.includes("localStorage")).map(([path]) => path)).toEqual([]);
  });

  it("commits in the learning home's style and pushes", async () => {
    const message = await git(session.home, ["log", "-1", "--format=%B"]);
    expect(message).toBe(`feat(${SLUG}): convert imported workspace to widgets`);
    expect(await git(session.remote, ["rev-parse", "main"])).toBe(await git(session.home, ["rev-parse", "HEAD"]));
    expect(await git(session.home, ["status", "--porcelain"])).toBe("");
  });

  it("records the custom widget's attempt in the app", async () => {
    const { open, eventsUntil, pageErrors } = await startWidgetApp({
      prepare: (root) => cp(join(session.home, SUBJECT), join(root, SUBJECT), { recursive: true }),
    });
    const lesson = await open(`/s/${SLUG}/lessons/0002-the-ka-row.html`);
    const widget = lesson.locator("kana-strokes");
    await expect.poll(() => widget.locator("button").count()).toBe(STROKES.length);
    for (const stroke of STROKES) await widget.getByRole("button", { name: stroke }).click();

    const events = await eventsUntil(SLUG, (events) => events.some((event) => event.kind === "attempt"));
    expect(events.find((event) => event.kind === "attempt")).toMatchObject({
      ref: "item:strokes-ka",
      outcome: "correct",
      grade: 3,
      schemaVersion: 1,
      data: { mistakes: 0 },
    });
    await expect.poll(() => widget.locator(".tome-verdict").textContent()).toBe("Right order");
    expect(pageErrors).toEqual([]);
    expect(await readdir(join(session.home, SUBJECT, "assets"))).toEqual(["kana-strokes.js"]);
    expect(await readFile(join(session.home, SUBJECT, "assets/kana-strokes.js"), "utf8")).toBe(KANA_STROKES);
  });
});
