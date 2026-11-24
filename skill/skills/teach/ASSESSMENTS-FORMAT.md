# Quizzes and exams

Quizzes and exams are scored HTML pages you write ahead of time, built from `<tome-exam-question>` widgets (see [WIDGETS.md](./WIDGETS.md)).

| | Quiz | Exam |
| --- | --- | --- |
| File | `subjects/<subject>/quizzes/<id>.html` | `subjects/<subject>/exams/<id>.html` |
| Tests | A short mix of items from several lessons | Transfer, cumulatively, with questions never seen before |
| Comes due | In the first quiz slot after the lesson its `tome-after` names | Once every lesson of the milestone that names it is completed |
| Recorded as | `quiz:<id>` | `exam:<id>` |
| Pass mark | The subject's `passMark` | The milestone's `passMark`, else the subject's |
| On a pass | Nothing more | The milestone becomes `done` |

- Worked examples: the quiz [`quizzes/k-m-r.html`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/quizzes/k-m-r.html) and the exam [`exams/first-five.html`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/exams/first-five.html), tied to its milestone in [`curriculum.json`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/curriculum.json).
- JSON Schemas: pages have none. A milestone's `exam` and `passMark` are in [`schemas/v1/curriculum.json`](https://github.com/isaacvarg/tomewise/blob/main/schemas/v1/curriculum.json); the scored `session.end` is in [`schemas/v1/event.json`](https://github.com/isaacvarg/tomewise/blob/main/schemas/v1/event.json).

## Writing a quiz

1. Pick the lesson after which the quiz comes due, and name it in the page's `<head>`:

   ```html
   <meta name="tome-after" content="lesson:0002-r">
   ```

2. Write each question as a `<tome-exam-question>` with an `id` unique on the page and `tests` naming the items it checks. Item widgets may sit beside them.
3. End the page with `<tome-done></tome-done>`, which reads "Finish quiz".

The quiz fills the first quiz slot that opens once that lesson is completed, so the learner gets it in place of an app-built quiz. Until it is taken it carries to later slots; once taken it fills none.

## Writing an exam

1. Name the exam's id in the milestone's `exam` in `curriculum.json` (read [CURRICULUM-FORMAT.md](./CURRICULUM-FORMAT.md)).
2. Write `exams/<id>.html` from `<tome-exam-question>`s only. Each question is new: never an item's own prompt.
3. End the page with `<tome-done></tome-done>`, which reads "Finish exam".

## Scoring and results

The app scores the session over every question on the page, unanswered ones counting as wrong, and records the percentage as `score` on its `session.end`, even when the learner's score display hides it. A miss brings the tested items forward in review; the question itself is never scheduled.

To go over results, read the latest `session.end` whose `ref` is `quiz:<id>` or `exam:<id>`, then its session's attempts: `data.question` names the question each answered.

## Rules

- **Answers give no clues.** Make every choice the same length in words, and vary which position holds the correct one.
- **Keep the subject's `attempt` payload fields optional**, or the questions' answers are rejected; see [SUBJECT-FORMAT.md](./SUBJECT-FORMAT.md).

Run `tome validate` after writing; it reports a `tome-after` that names no lesson.
