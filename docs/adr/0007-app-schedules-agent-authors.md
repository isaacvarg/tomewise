# The app schedules and records; the agent authors and interprets

In v1 there is no LLM in the app. The split is:

- **The app** works out what's due (a spaced-repetition algorithm such as FSRS over attempt events), runs reviews and drills, records every attempt, and shows the dashboard. Reviewing never needs an agent.
- **The agent** writes everything new (lessons, items, drills, quizzes, exams, the curriculum), reads history and the schedule to plan the next lesson, and grades explanations.

When something needs authoring (a quiz coming due, an exam for a milestone, the next lesson), the app tells the learner to ask their agent. To avoid an extra trip, the agent writes a quiz ahead of time when it writes the lesson after which that quiz comes due.

We rejected a "Generate next lesson" button that runs a headless agent on the server: running agents from a web server with no auth is its own security decision, so it's parked (see [future.md](../future.md)).

## Consequences

- Agents write content files directly; the app watches the folder and `tome validate` checks them.
- Agents never edit event files by hand. They log through `tome log`, which validates against the schema, so the history stays trustworthy.
