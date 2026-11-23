---
name: teach
description: Teach the learner a subject in their Tomewise learning home, one lesson at a time, planned from their history.
disable-model-invocation: true
argument-hint: "What would you like to learn about?"
---

The learner has asked you to teach them something. This is a stateful request: they learn the subject over many sessions, and their **learning home** holds the state. The app runs the lessons, records every answer and schedules reviews; you write the content.

## The learning home

Work from the learning home root, the folder with `tomewise.json`. Each subject is a folder under `subjects/`, and everything about it lives there:

| Path in `subjects/<subject>/` | What it is |
| --- | --- |
| `subject.json` | Name, payload schemas, assessment settings, charts. [SUBJECT-FORMAT.md](./SUBJECT-FORMAT.md) |
| `MISSION.md` | Why the learner wants this subject. [MISSION-FORMAT.md](./MISSION-FORMAT.md) |
| `RESOURCES.md` | Trusted sources to teach from. [RESOURCES-FORMAT.md](./RESOURCES-FORMAT.md) |
| `learning-records/NNNN-<name>.md` | What the learner has demonstrably learned, and changes of mission. [LEARNING-RECORD-FORMAT.md](./LEARNING-RECORD-FORMAT.md) |
| `GLOSSARY.md` | The subject's terms. [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md) |
| `NOTES.md` | Your scratchpad: the learner's preferences and working notes |
| `lessons/NNNN-<name>.html` | Lessons, numbered in order |
| `items/NNNN-<name>.json` | The items each lesson unlocks. [ITEMS-FORMAT.md](./ITEMS-FORMAT.md) |
| `drills/<id>.json` | Reusable practice over items. [DRILLS-FORMAT.md](./DRILLS-FORMAT.md) |
| `quizzes/`, `exams/` | Scored checks. [ASSESSMENTS-FORMAT.md](./ASSESSMENTS-FORMAT.md) |
| `curriculum.json` | The path of units and milestones. [CURRICULUM-FORMAT.md](./CURRICULUM-FORMAT.md) |
| `reference/*.html` | Reference sheets: cheat sheets, glossaries, sequences |
| `assets/` | Custom widgets, audio and anything lessons share |
| `events/` | The learner's history, written by the app. [EVENTS-FORMAT.md](./EVENTS-FORMAT.md) |

Read a file's format doc before writing or changing that file. Each links a worked example from the Morse example learning home and the JSON Schema to check against.

The app is the one writer of `events/`. Read history through `tome stats`, `tome due` and `tome query`, and record anything (such as a graded explanation) with `tome log`.

## A teaching session

A new subject, or a change to `curriculum.json`, follows [SUBJECT-SETUP.md](./SUBJECT-SETUP.md) first.

Every session, such as "next Morse lesson", runs these steps in order.

### 1. Before planning

From the learning home root, run:

```sh
git pull
tome stats --json
tome due --json
```

`git pull` brings in the history the app pushed since your last session. `tome stats --json` shows sessions, time, accuracy and streak; `tome due --json` lists the items the schedule says are due. If the pull fails, stop and show the learner the error.

Done when all three have run and you have read their output.

### 2. Plan the lesson

Choose one lesson in the learner's [zone of proximal development](#zone-of-proximal-development), tied to the [mission](#the-mission). Read `MISSION.md`, the `learning-records/`, `NOTES.md`, `curriculum.json` and the existing `lessons/`, `items/` and `drills/`. Weigh what step 1 showed: low accuracy or a long due list argues for consolidating before adding new material.

Done when you can name the lesson's single win and every item it adds.

### 3. Write the lesson

Write `lessons/NNNN-<name>.html`, numbered one past the last lesson. A lesson is a plain HTML page; the app injects the theme and the widgets, so it needs only a `<title>`, its content, and a `<script type="module">` for any custom widget in `assets/`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>A, the short pair</title>
</head>
<body>
<h1>A, the short pair</h1>
<p>A is di-dah.</p>
<tome-audio ref="item:letter-a" choices="A M K"></tome-audio>
<tome-drill drill="listen-pairs"></tome-drill>
<tome-done></tome-done>
</body>
</html>
```

- **Widgets for every practice and check.** Each answer a widget records moves the review schedule. Read [WIDGETS.md](./WIDGETS.md) before writing one. End the lesson with `<tome-done>` or a `final` widget.
- **Theme tokens for every style.** The learner's theme styles the page, headings and widgets. Style anything extra only with `.tome-*` classes and `var(--t-*)` tokens: `--t-bg`, `--t-surface`, `--t-ink`, `--t-muted`, `--t-rule`, `--t-accent`, `--t-accent-ink`, `--t-good`, `--t-good-bg`, `--t-bad`, `--t-bad-bg`, `--t-heat-0` to `--t-heat-4`, `--t-display`, `--t-ui`, `--t-mono`, `--t-radius`, `--t-cell-radius`. Then the lesson follows whatever theme the learner picks.
- **Short.** One tangible win that fits in working memory, completable in minutes.
- **Linked.** Link earlier lessons (`./0004-the-late-bump.html`) and reference sheets (`../reference/cheat-sheet.html`) with plain anchors.
- **Cited.** Back each claim with a link from `RESOURCES.md`, and recommend the single best primary source to read or watch.
- **A reminder** that the learner can ask you follow-up questions.

Done when every practice is a widget, the page ends in `<tome-done>` or a `final` widget, and every style is a token or a `.tome-*` class.

### 4. Write its items and drills

The lesson ships with what it unlocks:

- **Items** in `items/NNNN-<name>.json`, named after the lesson. Every item the lesson teaches has `"unlockedBy": "NNNN-<name>"`, and the lesson's widgets name them by ref (`item:letter-a`).
- **A drill** that draws the lesson's items by a tag they carry, run from the lesson with `<tome-drill drill="<id>">`. Write a new `drills/<id>.json`, or run an existing drill when its tags already cover the new items.

Done when every item the lesson shows is unlocked by it and the lesson runs a drill that draws them.

### 5. Validate

```sh
tome validate
```

Fix every problem it reports and run it again.

Done when it prints `<root> is valid.` and exits 0. Only then commit.

### 6. Commit and push

Commit the subject's changes in the learning home's style: Conventional Commits, scoped by subject folder (or `home` for `tomewise.json`), with no attribution lines.

| Change | Message |
| --- | --- |
| New content | `feat(morse-code): add lesson 5 (A, the short pair)` |
| Content fix | `fix(morse-code): correct item R audio speed` |
| Curriculum or settings | `chore(morse-code): update curriculum, milestone 1 done` |

```sh
git add subjects/<subject>
git commit --message "feat(<subject>): add lesson N (<title>)"
git push
```

The app pulls the push. Tell the learner the lesson is ready at `/s/<subject>/lessons/NNNN-<name>.html` in the app.

Done when `git push` succeeds.

## Philosophy

To learn at a deep level, the learner needs three things:

- **Knowledge**, captured from high-quality, high-trust resources
- **Skills**, acquired through highly relevant interactive lessons devised by you, based on the knowledge
- **Wisdom**, which comes from interacting with other learners and practitioners

Before `RESOURCES.md` is well populated, focus on finding high-quality resources that help the learner acquire knowledge. Never trust your parametric knowledge.

Some subjects need more skills than knowledge. Theoretical physics leans on knowledge; yoga on skills.

### Fluency vs storage strength

Split between two types of learning:

- **Fluency strength**: in-the-moment retrieval of knowledge
- **Storage strength**: long-term retention of knowledge

Fluency can give an illusory sense of mastery; storage strength is the real goal. Design lessons that build it by desirable difficulty:

- Retrieval practice (recall from memory)
- Spacing (practice distributed over time; the app's review schedule does this from what widgets record)
- Interleaving (mixing different but related topics in practice, for skills only)

## The mission

Tie every lesson to the mission: the reason the learner wants the subject.

If the mission is unclear or `MISSION.md` is empty, your first job is to ask the learner why they want to learn this. Without the mission, lessons feel abstract and you have no way to judge what comes next.

Missions change as the learner grows. Confirm a change with the learner, update `MISSION.md`, and add a learning record for it.

## Zone of proximal development

Each lesson should challenge the learner just enough. When they don't name what to learn, find it from their learning records, their history from step 1, and the mission, and teach the most relevant thing that fits.

## Knowledge

Design each lesson around a skill the learner is going to acquire, with only the knowledge that skill needs. Teach the knowledge first, then have the learner practise the skill through a feedback loop.

Gather knowledge from trusted resources and track them in `RESOURCES.md`. Cite generously: links to external sources back every claim.

For acquiring knowledge, difficulty is the enemy. It eats the working memory understanding needs.

## Skills

Skills are about durability and flexibility: make the knowledge stick. For skill acquisition, difficulty is the tool; effortful retrieval builds storage strength.

Teach skills through a **feedback loop**, as tight as possible: immediate, and ideally automatic. Widgets give that loop and record it. Use the item widgets for retrieval, `<tome-routine>` for real-world steps (yoga poses), `<tome-explain>` for the learner's own account of a concept, and `<tome-drill>` for practice over many items. A format no widget fits gets a custom widget in `assets/`, following [WIDGETS.md](./WIDGETS.md).

For multiple-choice questions, make every answer the same number of words (and characters, where possible), and vary the position of the correct answer. Give no clue through formatting or order.

The subject home charts only what you ask for: write **chart specs** in `subject.json` when the learner wants to see progress over time, such as speed, accuracy or practice minutes. Read [CHARTS-FORMAT.md](./CHARTS-FORMAT.md) before adding or changing one.

## Acquiring wisdom

Wisdom comes from real-world interaction: testing skills outside the learning home.

When a question seems to need wisdom, attempt an answer, then point to a **community**: a place, online or offline, where the learner can test their skills for real, such as a forum, a subreddit, a class or a local group. Find high-reputation ones. If the learner doesn't want to join one, respect it.

## Reference sheets

Alongside lessons, write reference sheets in `reference/`: the compressed essence of lessons, built for quick lookup and printing. Lessons are rarely revisited; reference sheets are.

Subjects that lend themselves to reference:

- Syntax and code snippets for programming
- Algorithms and flowcharts for processes
- Poses and sequences for yoga
- Exercises and routines for fitness
- Glossaries for any subject with its own nomenclature

Once `GLOSSARY.md` exists, use its terms in every lesson.

## `NOTES.md`

When the learner states a preference about how they want to be taught, or something to keep in mind, record it in `NOTES.md` and read it when planning.

## Credit

Forked from Matt Pocock's `teach` skill under the MIT License; see [LICENSE](./LICENSE).
