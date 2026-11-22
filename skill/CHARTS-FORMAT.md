# Chart specs

The subject home draws one chart per spec in the `charts` array of `subject.json`, and nothing else: a subject without specs shows the learner a prompt to ask you for charts. Each chart plots one value per day, with the day on the x axis.

## Structure

```json
{
  "name": "Morse code",
  "payloadSchemas": [ ... ],
  "charts": [
    { "id": "response-time", "title": "Response time", "kind": "line", "measure": "payload", "field": "responseTime", "days": 30 },
    { "id": "letter-accuracy", "title": "Letter accuracy", "kind": "line", "measure": "accuracy", "items": { "tag": "letter" }, "days": 30 },
    { "id": "listening-minutes", "title": "Listening practice", "kind": "bar", "measure": "minutes", "items": { "drill": "listen" }, "days": 14 }
  ]
}
```

| Key | Value |
| --- | --- |
| `id` | Lowercase words joined by hyphens, unique among the subject's charts |
| `title` | What the learner sees above the chart |
| `kind` | `line` for a trend, `bar` for amounts per day |
| `measure` | `payload`, `accuracy`, `attempts` or `minutes` (below) |
| `field` | The attempt payload field to plot; `payload` charts only |
| `aggregate` | `mean`, `median` or `total`; `payload`, `attempts` and `minutes` charts only |
| `items` | Optional filter, exactly one of `{ "tag": "letter" }`, `{ "type": "timed-audio" }` or `{ "drill": "listen" }` |
| `days` | How many days the chart shows, ending today; at most 3650 |

## Measures

| Measure | Each day's value | Default `aggregate` | Axis unit |
| --- | --- | --- | --- |
| `payload` | The `aggregate` of `field` over that day's attempts; array fields count each element | `median` | The field's `unit` in the payload schema |
| `accuracy` | Correct attempts over all attempts | none | ratio |
| `attempts` | `total`: attempts that day. `mean` / `median`: attempts per session, on the day of its first attempt | `total` | none |
| `minutes` | `total`: session minutes that day. `mean` / `median`: minutes per session | `total` | min |

- `field` names a number or integer field (or a numeric enum, or an array of those) in the subject's `attempt` payload schema. Give the field a `unit` so the axis is labelled.
- Days split at midnight in the learning home's `timezone`; a session counts on the day it started.
- A day with nothing to measure is a gap in the chart, except totals of attempts and minutes, which show 0.
- `items` narrows attempts to items with the tag, items of the type, or attempts made in sessions of the drill (`review` is the built-in one). Minutes belong to whole sessions, so filter them by `drill` only.

## Rules

- **Chart what the mission cares about.** One chart per question the learner asks about their progress ("am I getting faster?"), not one per field.
- **Pick the window to match the pace.** 7–14 days for daily routines, 30–90 for slow-moving skills.
- **Run `tome validate`** after editing; it reports a bad spec, an unknown or non-numeric `field`, an unknown tag or drill, and duplicate ids, each with its path.
