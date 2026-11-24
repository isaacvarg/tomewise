# The app edits the settings the learner picks in it, one key at a time

The dashboard's settings page lets the learner choose a theme, the Start mode, the order of their subjects, and how quizzes and exams work, for the whole home and per subject. Telling the learner to edit `tomewise.json` by hand for these would be the only place the app sends them to a file, and the theme needs a live preview to choose well. So the app writes these settings itself.

ADR 0011 makes the agent the only writer of content. This is a narrow exception: when the learner saves a setting in the app, the app rewrites `tomewise.json` changing only that key, keeping the rest of the file (other keys, key order, formatting) as it was. The settings the app may write are `theme`, `start`, `subjects` and `assessments` in `tomewise.json`, and `settings.assessments` in a subject's `subject.json`, which it rewrites the same way. Everything else stays a file edit. The app never edits history this way; history stays events (ADR 0011).

## Considered options

- Drop the settings page and document the keys: no new writer, but a theme can't be previewed and reordering subjects by hand is error-prone.
- Store these settings per device in the browser: no file writes, but the learner's choice wouldn't follow them from phone to laptop, and the agent couldn't see it.

## Consequences

- With git sync on, each save is its own commit, made at once rather than on the history cadence and pushed when push is on: `chore(home): set theme to meadow`, or `chore(<subject>): set assessments` for a subject. The commit holds only the saved key, built from the committed file, so edits the agent hasn't committed in the same file stay uncommitted. A save the app couldn't commit, because sync had stopped, is committed on the next Sync now. With sync off, the learner commits settings by hand.
- The agent and the app can both edit `tomewise.json`. Because the app touches one key per save, a conflict needs both to change the same key between syncs.
- Adding a setting to the page means adding its key to the list above.
