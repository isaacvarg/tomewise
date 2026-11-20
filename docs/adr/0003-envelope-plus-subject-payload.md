# Events are a shared envelope plus a payload the agent designs per subject

What's worth tracking differs completely between subjects (millisecond dit/dah timings for Morse, hold times for yoga), so no fixed schema can cover them. Every event therefore has a fixed **envelope** (`ts`, `subject`, `kind`, `ref`, `sessionId`, `duration`, `outcome`) and a free-form `data` **payload**. The agent writes each subject's payload schema into `subject.json` when it sets the subject up. Everything shared (heatmap, streaks, due reviews, "last practised") reads only the envelope; subject charts and queries read the payload through its schema.

## Considered options

- A fixed universal schema: can't predict the needs of every subject.
- A separate free-form JSON file per subject with no envelope: then nothing can be shown across subjects.

## Consequences

- One event per attempt, grouped by `sessionId`, with a closing `session.end` event. The scheduler and `jq` work on attempts directly, and a session that crashes halfway keeps what was done.
- Subject charts are declared as specs in `subject.json` (for example, line chart of `data.wpm` over time), written by the agent and drawn by built-in chart components. The learner never writes this config; the agent doesn't write chart code.
- The CLI's `query` command is driven by the schema, so it needs no subject-specific code.
