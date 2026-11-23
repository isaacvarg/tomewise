# Design overview (v1)

The settled shape of v1, from the grilling sessions of 2026-11-19/20. Terms are defined in [CONTEXT.md](../CONTEXT.md); the reasons behind the big choices are in [docs/adr/](./adr/). Parked ideas are in [future.md](./future.md).

## Goal

A self-hosted, agent-written learning platform that others can install and use. It is single-user (one learner, one learning home) and dogfooded on one real subject before it's polished for strangers. PKM tools are optional.

What it adds to `teach`: practice results that are kept, an always-on app to learn and review in, spaced repetition from real history, assessments, and an optional visible curriculum.

## The two halves

```
tomewise/                        the tool (what gets published)
  core/      event read/write, schemas, stats, scheduler (shared by all below)
  app/       Hono server + Vite/React dashboard
  cli/       init, stats, query, due, log, validate, import, serve, service
  widgets/   tome.js + web components (quiz, flashcard, timer, audio, explain, ...)
  skill/     the forked teach skill + format docs
  .claude-plugin/

~/learning/                    a learning home (the learner's own git repo)
  tomewise.json                   formatVersion, global defaults, timezone, week start, streak rules, git settings, theme, Start mode, subject order
  subjects/
    morse-code/
      subject.json             payload schema, chart specs, goals, assessment settings
      curriculum.json          optional
      MISSION.md  RESOURCES.md  GLOSSARY.md  NOTES.md
      learning-records/0001-...md
      lessons/0001-...html
      quizzes/  exams/
      items/*.json
      drills/*.json
      reference/*.html
      assets/                  this subject's own widgets
      events/2026-11.jsonl
```

Finding the learning home: walk up from the current directory to `tomewise.json`, then the global config (`~/.config/tomewise/config.json`, written by `init`), then an env var.

## Data

- **Events** are appended to `events/YYYY-MM.jsonl`, one per attempt, plus lesson/session events.
  - Envelope: `id` (ULID), `ts` (UTC ISO 8601), `subject`, `kind`, `ref`, `sessionId`, `duration` (whole ms), `outcome` (`correct` / `wrong` / `skipped`), `grade` (1–4, attempts only), `score` (0–100, `session.end` only), `schemaVersion`.
  - Kinds in v1: `attempt`, `session.start`, `session.end`, `lesson.completed`, `explanation.saved`, `explanation.graded`, `milestone.status`, `goal.changed`, `streak.changed`. Other settings, the curriculum and the mission stay file edits. When the app sees a goal or streak rule change in the files, it appends `goal.changed` or `streak.changed`, so past days are judged by the rules in force on that day.
  - `ref` is typed as `kind:id`: `item:letter-u`, `lesson:0004-the-late-bump`, `drill:listen-kmrsu`, `event:<ulid>`. Item ids are unique within a subject.
  - Payload: `data`, shaped by the schema in `subject.json`.
  - A session opens with `session.start` (its `ref` is the lesson, drill, quiz or exam) and closes with `session.end`. An exam's `session.end` carries the app's `score` for it, a percentage in the envelope; an app-built quiz's carries the score of its planned items, unanswered ones counting as missed. An attempt's `ref` is always the item. An event about another event (an explanation's grade) uses that event's `id` as its `ref`.
  - Payload schemas are versioned and only ever extended, so old events stay valid. Each event records the `schemaVersion` it was written under. A payload schema is a restricted JSON Schema (number, integer, string, boolean, enum, arrays of those), and each field may carry a `unit` (`ms`, `s`, `wpm`, `ratio`, ...).
- **Schemas as code**: Zod schemas in `core` are the source of truth. JSON Schema files are generated from them and served at a versioned path, for `tome validate` and for agents without the tool.
- **Scheduler state** is never stored: it's rebuilt by replaying attempt events through FSRS on start.
- **Items** (`items/*.json`, one file per item set, usually one per lesson, holding an array): stable `id`, `type`, type-specific fields, `unlockedBy`, tags, `retired`. Items are edited in place; a change of meaning retires the item and adds a new one with a new `id`. Retired items are never deleted. Built-in types: flashcard, multiple choice, typed answer, timed/audio, routine (guided sequence, self-rated 1–4). Routines are recorded and charted but skip the scheduler; how often they're done comes from a goal. Custom types come with a widget in `assets/`.
- **Drills** (`drills/*.json`): which items (due / tag / all unlocked), how many, the format, time limits. "Review everything due" is a built-in drill.
- **Chart specs** in `subject.json` (`charts`, an array) are declarative and written by the agent. Each chart has an `id`, a `title`, a `kind` (`line` or `bar`), a `measure` (`payload`, `accuracy`, `attempts` or `minutes`), a `field` (required when `measure` is `payload`; a numeric payload field), an `aggregate` (`mean`, `median` or `total`; defaults to `median` for payload and `total` for attempts and minutes), an optional `items` filter (`tag`, `type` or `drill`) and a window in `days`. The x axis is the day. Axis units come from the payload field's `unit`. Core validates chart specs with the rest of `subject.json`.
- **Settings** have defaults in `tomewise.json`, overridden per subject in `subject.json`. From its settings page the app writes four keys in `tomewise.json` and one in `subject.json`, and nothing else (ADR 0014): `theme`, `start` (`sequence` or `ask`, default `sequence`), `subjects` (an optional order of subject ids; unlisted subjects follow alphabetically), `assessments`, and a subject's `settings.assessments`.
- **Assessment settings** (`assessments` in `tomewise.json`, written by `tome init`): `enabled`, `quizFrequency` (`{ "every": N }` lessons, `"weekly"` or `"onDemand"`), `quizLength`, `exams`, `timed` (`false` or `{ "minutes": N }`), `scoreDisplay` (`number`, `pass-fail` or `hidden`) and `passMark` (a percentage). Defaults: on, every 5 lessons, 10 questions, exams on, untimed, number, 70. A subject overrides any of them in `settings.assessments` in `subject.json`; each one it leaves out comes from `tomewise.json`. A milestone in `curriculum.json` may set its own `passMark`, which wins for its exam. Passing means score ≥ pass mark. The app server gives each subject's resolved settings in `settings.assessments`.
- **Days and weeks**: all day boundaries use the `timezone` in `tomewise.json` (defaulting to the system zone at `init`). A session counts on the day it started. Weeks run Monday to Sunday by default. Sessions shorter than a minimum length (default 60s) don't make an activity day.

## Learning model

- **Lessons** teach once and are never locked. Completion is a `lesson.completed` event, sent when the final check passes or when the learner clicks Done. Completing a lesson unlocks its items (`unlockedBy`). A drill is unlocked once it has an unlocked item. In the app, lessons and reference sheets in an `upcoming` milestone are marked as later (still openable); those in other milestones, in no milestone, or in a subject with no curriculum are not.
- **Review** happens in the app with no agent: the scheduler (FSRS via `ts-fsrs`, default parameters at first, tuned to the learner's own history once there are enough reviews) picks due items. Every attempt on an item updates its schedule, whether it came from a review, a drill, a quiz or a lesson check; the algorithm handles early practice.
- **Quizzes** are short and scored and mix items across lessons. **Exams** are longer and cumulative and use exam questions: new, never scheduled, each naming the items it tests. Quizzes and exams the agent writes are HTML pages built from widgets; each exam question is a `<tome-exam-question tests="item:letter-k item:letter-r">` widget. A quiz the app builds is a drill run in quiz mode and needs no file. Both are written by the agent ahead of time; the agent writes a quiz together with the lesson after which it comes due. If a quiz comes due (say, weekly) and none has been written, the app builds one by rule from the scheduler's state (the weakest items plus some that used to be missed), and the agent reads the results next time. A quiz slot opens with every Nth distinct lesson completed, or at the start of each week (local midnight on `weekStart`) once the learner had a session in an earlier week; on demand or with assessments off, none opens. The latest open slot is due until a quiz session (`quiz:<id>` or `drill:quiz-<date>`) ends with a score at or after it opens (a quiz left early ends with none); missed slots don't pile up. The app server gives it at `/api/subjects/:subject/quiz/due`.
- **Assessment settings**: assessments on/off, quiz frequency (every N lessons / weekly / on demand), quiz length, exams on/off, timed or untimed, score display (number / pass-fail / hidden). Hidden scores are still recorded. Defaults are chosen during `init` and stored in `tomewise.json`; each subject can override them in `subject.json`.
- **Results** feed the agent's choice of next lesson, are suggested as evidence for learning records (the learner confirms), and missed items move forward in the review schedule.
- **Curriculum** (optional): units and milestones with statuses. The agent drafts it from real syllabi in `RESOURCES.md`. It's a compass: changes are proposed and confirmed, and each gets a learning record.
- **Exams and milestones**: when a milestone's lessons are done it shows "exam ready" (or "ask your agent to prepare it"). Passing marks the milestone done; failing locks nothing. With exams off, the learner or the agent marks milestones done. A milestone's status is the `data.status` of its latest `milestone.status` event, falling back to the status in `curriculum.json`.
- **Feynman-lite**: `<tome-explain>` saves a free-text explanation as `ungraded`. Next time the learner talks to their agent, the skill grades it and writes feedback back as an event (`explanation.graded`, its `data.feedback` required), which the app shows next to the explanation.

## Metrics

- **Heatmap**: every activity day in every subject.
- **Streak**: consecutive activity days, with an optional weekly allowance of rest days.
- **Goals** per subject: proposed by the agent, approved by the learner, progress (minutes today or this week) shown on the subject home.
- **Subject charts**: drawn from the chart specs. A subject with none shows a prompt to ask the agent for charts; there are no default charts.

## App

- Vite + React SPA with a Hono server in a single Node process.
- Works equally on phone, tablet and desktop. The phone is one of several places to learn, not the main target, so every page is designed for each width and the drill runner works by touch and by keyboard.
- Serves lessons from the learning home. `tome.js` posts to `/api/events` on the same origin.
- Widgets are served under a major-version path (`/widgets/v1/tome.js`). Within a major version they only gain features; a v2 ships alongside v1 and both stay served, so old lessons keep working.
- Watches the learning home so new content shows up live. One server-sent event stream tells open pages what changed (content or events) and they refetch.
- No auth; meant for localhost or a private network. The expected setup is the app on a home server, reached from phone and laptop over Tailscale. A second learner in the same household runs their own instance with their own learning home (the docs include a two-instance compose example). Ships as an OCI image and via `npx`.
- The app is the only writer of history: `tome log` posts to it, and falls back to a per-machine event file when it's unreachable. Content travels by git: the agent pushes, the app pulls, commits events and pushes (ADR 0011).
- Themes are modular from day one (see below).
- Pages:
  - home, top to bottom: activity heatmap; a visual grid of subjects (no progress shown); what's due; streak; one Start button. Wide screens keep that order but use the width: the heatmap spans a year, subjects sit four across, and due and streak sit side by side;
  - Start runs what's due. In `sequence` mode it runs each subject with items due, in subject order, one session of the built-in review drill each, with a break screen between subjects (a short summary, then Continue, Skip or Done). In `ask` mode it lists the subjects with due items, with "All, one after another" on top. Due quizzes show in "what's due" on home and the subject home and are started from there, never from Start; starting one runs the app-built quiz;
  - subject home, a dashboard for one subject with tabs. Overview, top to bottom: goal progress; that subject's activity heatmap; "ask your agent" prompts (only when there are any); what's due here, with a Start for this subject. The other tabs: Curriculum (the roadmap with lessons under their milestones, and "Other lessons" for the rest), Drills, Reference (the glossary first, then the agent's reference sheets) and Stats (totals, then charts). Each tab has its own address (`/s/morse-code/curriculum`). Wide screens: the Overview puts goal and heatmap side by side, then prompts and due; Drills and Reference go two across; Stats shows charts two across;
  - glossary, built by the app for every subject: each unlocked item grouped under the lesson that unlocked it, in curriculum order, with when it is next due and a play button for audio items. Explanations such as how WPM timing works stay in the agent's reference sheets;
  - review/drill runner, a centred column at every width, ending in a summary: score, time, and items to look at again (wrong, rated Again, or timed out), each linked to the lesson that unlocked it. After a sequence the summary covers every subject;
  - prompts, derived from state: a milestone whose lessons are done, an exam that's ready, an explanation waiting to be graded. A milestone counts once every lesson it lists is completed and its status isn't `done` or `skipped`; its prompt asks for the exam when it names one with no file yet, links the exam when the file exists, and otherwise asks to mark the milestone done. The subject home lists them; home shows how many each subject has. While a quiz is due with none written, a prompt asks the agent for it and offers the app-built quiz alongside;
  - settings: theme (previewed live, then saved or cancelled), Start mode, and subject order (drag, or up and down buttons on each row).

## CLI

| Command | Does |
|---|---|
| `init` | Create a learning home (see below) |
| `stats` | Envelope-level stats: sessions, time, streaks |
| `query` | Payload queries driven by the subject schema |
| `due` | What's due to review |
| `log` | Append a validated event (how agents record activity) |
| `validate` | Check subject, item, drill and curriculum files |
| `import <dir>` | Convert a `teach` workspace into a subject |
| `serve` / `service install` | Run the app now / as a background service |

`init` asks:
1. Where to put the learning home. Using Obsidian? Then which subfolder of which vault.
2. Use git? If so, the auto-commit cadence (per session / hourly / daily) and whether to push to a remote. If not, the learner commits by hand.
3. Default assessment settings (subjects can override them later).
4. Install the skill for which agents.
5. Run the app now, install it as a service, or print the Docker command.
6. Create a first subject now (hands off to the agent).

Commit messages in a learning home follow Conventional Commits, scoped by subject folder (or `home` for `tomewise.json`), with no attribution lines:

```
feat(morse): add lesson 5 (A, the short pair)       agent: new content
fix(morse): correct item R audio speed              agent: content fix
chore(morse): update curriculum, milestone 1 done   agent: curriculum or settings
chore(history): 2026-11-21 · morse 3 sessions, 18 min, 96 attempts   app: events
```

`tome import <dir>` copies a `teach` workspace into a new subject, then the agent converts its interactive drills into widgets that follow the event contract (generic ones become built-ins, subject-specific ones go in the subject's `assets/`) and rewrites the lessons to use them. Lessons that existed are marked complete; history kept only in the browser (`localStorage`) is dropped, and the learning records and `NOTES.md` carry what was learned.

Agents query history in layers: raw files with `jq` always work (the files are the contract); the CLI is the documented interface the skill uses; an MCP server may wrap the same core later.

## Themes

A theme is a folder: `theme.json` (name, author, version), `tokens.css` (light and dark), optional extra CSS, JavaScript and assets. Themes may change anything about appearance, layout included. Theme JavaScript runs on every page, lessons included, so themes are trusted code: install only ones you trust. Built-ins ship in the tool's `themes/`; personal themes go in the learning home's `themes/`; community themes come by pull request. The chosen theme is stored in `tomewise.json` and applies to the app, the widgets and lessons. v1 ships Paper (from the Morse workspace's stylesheet) and Meadow, a nature theme. See ADR 0012. Both are mocked up, tokens included, in [mockups/](./mockups/).

Checking a theme: the app has a `/styleguide` page showing every page and widget state with demo data. `tome theme check <name>` screenshots it at phone, tablet and desktop widths in light and dark, and reports contrast failures and horizontal overflow. CI runs it on every theme in a pull request.

Styling stack: plain CSS with tokens, semantic class names and `@layer`; no Tailwind. Widgets are Lit components rendered in the light DOM so themes can reach them (ADR 0013).

## Skills

A Claude Code plugin named `tomewise` (skills also on skills.sh with a `tomewise-` prefix, since it has no namespaces) bundling several skills in the Agent Skills format:
- **`teach`** (`/tomewise:teach`): a fork of `teach` (MIT, credited);
- **`theme`** (`/tomewise:theme`): build or change a theme, following the theme contract and checklist (phone width, light and dark, contrast, every page and widget);
- **`theme-check`** (`/tomewise:theme-check`): the review loop, kept separate because the learner iterates on a theme many times. It runs `tome theme check`, shows the screenshots, takes the learner's feedback, and repeats until they're happy.

On top of `teach`, the teaching skill:
- reads history and the schedule before planning;
- writes items, drills, quizzes, exams, `subject.json` and `curriculum.json`;
- builds lessons from the widgets, styled only with theme tokens;
- logs only through the CLI;
- asks the learner about their assessment preferences when setting up a subject;
- grades ungraded explanations.

## Vault mode

Scaffolds into a vault subfolder, writes a Markdown note per session (frontmatter summary), a Markdown copy of the curriculum, and Obsidian Base views.

## Still open

- The concrete JSON schemas (envelope fields and types, item and drill files, `subject.json`, `curriculum.json`). This is spec work.
