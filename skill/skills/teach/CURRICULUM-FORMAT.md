# curriculum.json

`subjects/<subject>/curriculum.json` is an optional, undated, ordered path of units and milestones: a compass, not a track. Propose changes to the learner and write them once they agree, with a learning record saying why.

- Worked example: [`curriculum.json`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/curriculum.json) in the Morse example.
- JSON Schema: [`schemas/v1/curriculum.json`](https://github.com/isaacvarg/tomewise/blob/main/schemas/v1/curriculum.json).

## Structure

```json
{
  "units": [
    {
      "title": "Koch letters",
      "milestones": [
        { "id": "first-five", "title": "Copy K, M, R, S and U", "status": "current", "lessons": ["0001-k-and-m", "0002-r"], "reference": ["k-and-m-timing"], "exam": "first-five", "passMark": 80 }
      ]
    }
  ]
}
```

| Milestone key | Value |
| --- | --- |
| `id` | Lowercase letters, digits and hyphens, unique in the subject; events refer to it as `milestone:<id>` |
| `title` | What the learner is able to do at this point |
| `status` | `done`, `current`, `upcoming`, `skipped` or `changed` |
| `lessons` | Lesson ids in `lessons/` that lead to it |
| `reference` | Reference sheet ids in `reference/` that go with it; the app marks them as later while the milestone is `upcoming` |
| `exam` | The id of `exams/<id>.html` that tests it |
| `passMark` | The exam's pass mark as a percentage; wins over the subject's |

## Status

`status` in the file is the starting point. The app records later changes as `milestone.status` events, and the latest event wins: passing the milestone's exam marks it `done`. Read events for the current status before editing the file; change `status` in the file only when the plan itself changes.

Run `tome validate` after editing; it reports a lesson id that names no lesson and a reference id that names no sheet.
