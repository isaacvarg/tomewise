# Lessons are agent-written HTML built from shared web-component widgets

Lessons, quizzes and exams stay what `teach` makes: self-contained HTML the agent writes, free in layout and content per subject (a Morse audio trainer vs a yoga sequence), with colours, fonts and decoration coming from the learner's theme (ADR 0012). They are built from shared **web components** (`<tome-quiz>`, `<tome-flashcard>`, `<tome-timer>`, `<tome-explain>`, ...) served by the app, and those widgets are the only way results get reported.

We rejected structured JSON lessons rendered by app components (consistent, but caps the agent at whatever components exist) and React widgets (would need a build step the agent has to run). Web components work in any HTML file, the agent just writes tags, and the app's own review pages use the same widgets, so a flashcard behaves identically everywhere.

## Consequences

- Widgets are framework-free (or Lit), so the app's framework choice doesn't leak into lessons.
- A subject can add a custom widget in its `assets/` when a format is truly new; it must follow the item and event contract.
