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
  tomewise.json                   formatVersion, global defaults, streak rules, git settings
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
  - Envelope: `ts`, `subject`, `kind`, `ref`, `sessionId`, `duration`, `outcome`.
  - Payload: `data`, shaped by the schema in `subject.json`.
- **Items** (`items/*.json`): stable `id`, `type`, type-specific fields, `unlockedBy`, tags. Built-in types: flashcard, multiple choice, typed answer, timed/audio, routine (guided sequence, self-rated 1–4). Custom types come with a widget in `assets/`.
- **Drills** (`drills/*.json`): which items (due / tag / all unlocked), how many, the format, time limits. "Review everything due" is a built-in drill.
- **Chart specs** in `subject.json` are declarative and written by the agent.
- **Settings** have defaults in `tomewise.json`, overridden per subject in `subject.json`.

## Learning model

- **Lessons** teach once and are never locked. Completion is a `lesson.completed` event, sent when the final check passes or when the learner clicks Done. Completing a lesson unlocks its items, drills and reference sheets.
- **Review** happens in the app with no agent: the scheduler (FSRS or similar) picks due items and every attempt updates them.
- **Quizzes** are short and scored and mix items across lessons. **Exams** are longer and cumulative and use new questions. Both are written by the agent ahead of time; the agent writes a quiz together with the lesson after which it comes due.
- **Assessment settings**: assessments on/off, quiz frequency (every N lessons / weekly / on demand), quiz length, exams on/off, timed or untimed, score display (number / pass-fail / hidden). Hidden scores are still recorded.
- **Results** feed the agent's choice of next lesson, are suggested as evidence for learning records (the learner confirms), and missed items move forward in the review schedule.
- **Curriculum** (optional): units and milestones with statuses. The agent drafts it from real syllabi in `RESOURCES.md`. It's a compass: changes are proposed and confirmed, and each gets a learning record.
- **Exams and milestones**: when a milestone's lessons are done it shows "exam ready" (or "ask your agent to prepare it"). Passing marks the milestone done; failing locks nothing. With exams off, the learner or the agent marks milestones done.
- **Feynman-lite**: `<tome-explain>` saves a free-text explanation as `ungraded`. Next time the learner talks to their agent, the skill grades it and writes feedback back as an event, which the app shows.

## Metrics

- **Heatmap**: every activity day in every subject.
- **Streak**: consecutive activity days, with an optional weekly allowance of rest days.
- **Goals** per subject: proposed by the agent, approved by the learner, progress shown on the dashboard.
- **Subject charts**: drawn from the chart specs.

## App

- Vite + React SPA with a Hono server in a single Node process.
- Serves lessons from the learning home. `tome.js` posts to `/api/events` on the same origin.
- Watches the learning home so new content shows up live.
- No auth; meant for localhost or a private network. Ships as an OCI image and via `npx`.
- Pages:
  - all subjects;
  - activity heatmap and streak;
  - due today;
  - subject home (curriculum roadmap, lessons, drills, charts, goals);
  - review/drill runner;
  - prompts such as "ask your agent for your quiz".

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
3. Install the skill for which agents.
4. Run the app now, install it as a service, or print the Docker command.
5. Create a first subject now (hands off to the agent).

Agents query history in layers: raw files with `jq` always work (the files are the contract); the CLI is the documented interface the skill uses; an MCP server may wrap the same core later.

## Skill

A fork of `teach` (MIT, credited) in the Agent Skills format, shipped as a Claude Code plugin and through skills.sh. On top of `teach`, it:
- reads history and the schedule before planning;
- writes items, drills, quizzes, exams, `subject.json` and `curriculum.json`;
- builds lessons from the widgets;
- logs only through the CLI;
- asks the learner about their assessment preferences when setting up a subject;
- grades ungraded explanations.

## Vault mode

Scaffolds into a vault subfolder, writes a Markdown note per session (frontmatter summary), a Markdown copy of the curriculum, and Obsidian Base views.

## Still open

- **Name: settled, Tomewise.** Repo, npm package and skill are `tomewise`; the CLI command is `tome`. See [names.md](./names.md).
- The concrete JSON schemas (envelope fields and types, item and drill files, `subject.json`, `curriculum.json`). This is spec work.
- The choice of scheduling algorithm (FSRS vs SM-2) and its parameters.
