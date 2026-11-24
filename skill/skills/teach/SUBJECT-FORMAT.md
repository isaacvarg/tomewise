# subject.json

Each subject is a folder `subjects/<subject>/`, named with lowercase letters, digits and hyphens. Its `subject.json` names the subject and describes the shape of its event payloads.

- Worked example: [`subject.json`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/subject.json) in the Morse example.
- JSON Schema: [`schemas/v1/subject.json`](https://github.com/isaacvarg/tomewise/blob/main/schemas/v1/subject.json).

## Structure

| Key | Value |
| --- | --- |
| `name` | What the learner sees, such as `"Morse code"` |
| `payloadSchemas` | The payload schema versions, below |
| `charts` | Chart specs; read [CHARTS-FORMAT.md](./CHARTS-FORMAT.md) before adding one |
| `goals` | `[{ "id": "copy", "per": "day", "minutes": 10 }]`: targets the learner approved |
| `settings` | `minimumSessionSeconds`, and `assessments` overrides: `enabled`, `quizFrequency`, `quizLength`, `exams`, `timed`, `scoreDisplay`, `passMark`. Each one left out comes from `tomewise.json` |

The learner picks `settings` and `goals` in the app. Propose a change and let the learner make it.

## Payload schemas

A payload schema version says which `data` fields each event kind carries:

```json
"payloadSchemas": [
  {
    "version": 1,
    "kinds": {
      "attempt": {
        "type": "object",
        "properties": {
          "heard": { "type": "string" },
          "responseTime": { "type": "integer", "unit": "ms" }
        },
        "required": ["heard", "responseTime"]
      }
    }
  }
]
```

- **Fields** are `{ "type": "number" | "integer" | "string" | "boolean" }`, `{ "enum": [...] }`, or `{ "type": "array", "items": <one of those> }`. Give numeric fields a `unit` so charts label their axis.
- **Versions are append-only.** Number them 1, 2, 3 in order. Each new version keeps every kind and field of the one before, unchanged; it may add fields, add kinds, and add values to an enum. Events name their version in `schemaVersion`, so old events stay valid forever.
- **To change a payload, add a version.** Copy the latest, extend it, and append it. The Morse example's version 2 adds `wpm`.
- **`question` is reserved** on `attempt`: quiz and exam answers use it for the question id.
- **Keep `attempt` fields optional once a subject has quizzes or exams.** A `<tome-exam-question>` records only `data: { "question": "<id>" }`, which a required field rejects. The Morse example's version 3 drops `required` for its quiz and exam.
- **Leave kinds out** that need nothing subject-specific; their `data` is `{}`.

Run `tome validate` after editing; it reports a dropped or changed field, a version out of order, and a required field missing from `properties`.
