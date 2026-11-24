# Events

A subject's history is its events: one JSON object per line in `subjects/<subject>/events/YYYY-MM.jsonl` (or `YYYY-MM.<machine>.jsonl`), in the month of its `ts`. The app writes every event file. You read them to plan teaching, and you add an event with `tome log '<event JSON>'`, which sends it to the app.

- Worked example: [`events/2026-11.jsonl`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/events/2026-11.jsonl) in the Morse example: a lesson, a drill, a review, and an explanation saved then graded.
- JSON Schema: [`schemas/v1/event.json`](https://github.com/isaacvarg/tomewise/blob/main/schemas/v1/event.json) checks one line's envelope.

## Envelope

Every event carries the same envelope; only `data` differs by subject.

```json
{"id":"01M6ERD2PPMP84QJC72RVQ3BTV","ts":"2026-11-02T18:30:02.710Z","subject":"morse-code","kind":"attempt","ref":"item:letter-r","sessionId":"01M6ERD020P2CVN6ZRA7VR3Q9N","duration":1210,"outcome":"correct","grade":3,"schemaVersion":2,"data":{"heard":"R","answer":"R","responseTime":1210,"wpm":18}}
```

| Key | Value |
| --- | --- |
| `id` | A ULID, unique in the subject. `tome log` fills it in when left out |
| `ts` | UTC ISO 8601 with `Z`. `tome log` fills it in when left out |
| `subject` | The subject's folder name |
| `kind` | One of the kinds below |
| `ref` | What the event is about, as `kind:id` (below) |
| `sessionId` | The `id` of the session's `session.start` |
| `duration` | Whole milliseconds |
| `outcome` | `correct`, `wrong` or `skipped`; attempts only |
| `grade` | 1–4 (again, hard, good, easy); attempts only |
| `score` | 0–100, the app's score of a quiz or exam; `session.end` only |
| `schemaVersion` | The payload schema version `data` follows |
| `data` | The payload: an object, `{}` when there is nothing to add |

## Refs

A ref is `kind:id` and must name something that exists in the subject:

| Ref | Names |
| --- | --- |
| `item:<id>` | An item in `items/*.json` |
| `lesson:<id>` | `lessons/<id>.html` |
| `drill:<id>` | `drills/<id>.json`, the built-in `review`, or an app-built quiz `quiz-YYYY-MM-DD` |
| `quiz:<id>` | `quizzes/<id>.html` |
| `exam:<id>` | `exams/<id>.html` |
| `milestone:<id>` | A milestone in `curriculum.json` |
| `event:<id>` | An earlier event in the subject |

## Kinds

| Kind | `ref` | Also needs | `data` |
| --- | --- | --- | --- |
| `session.start` | lesson, drill, quiz or exam | `sessionId` equal to its own `id` | payload |
| `attempt` | item | `sessionId`, `outcome`, `grade` | payload; plus `question` on a quiz or exam answer |
| `session.end` | lesson, drill, quiz or exam | `sessionId`, `duration`; `score` on a scored quiz or exam | payload |
| `lesson.completed` | lesson | | payload |
| `explanation.saved` | lesson or item | | `text`: the learner's explanation |
| `explanation.graded` | event: the `explanation.saved` | | `feedback`: your feedback, required |
| `milestone.status` | milestone | | `status`: `done`, `current`, `upcoming`, `skipped` or `changed` |
| `goal.changed` | none | | `from`, `to`: the subject's goals before and after |
| `streak.changed` | none | | `from`, `to`: `{ "restDaysPerWeek": N }` before and after |

`grade` belongs to attempts only and `score` to `session.end` only; any other kind carrying either is rejected.

## Grading an explanation

Follow [GRADING.md](./GRADING.md): it finds ungraded explanations, says what feedback to write, and shows the `tome log` call. An `explanation.graded` without non-empty `feedback` is rejected.

## Payload

`data` is checked against the payload schema version named by `schemaVersion`, in the subject's `subject.json`. Kinds the schema does not mention take `{}`, except the fixed fields in the table above. Read [SUBJECT-FORMAT.md](./SUBJECT-FORMAT.md) before adding or changing a payload schema.

Run `tome validate` after logging by hand; it reports each bad line with its file, line and path.
