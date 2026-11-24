# Items

Items live in `subjects/<subject>/items/*.json`. Each file is an item set: a JSON array of items, usually the ones one lesson unlocks, named after that lesson (`0002-r.json`).

- Worked example: [`items/0001-k-and-m.json`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/items/0001-k-and-m.json) in the Morse example.
- JSON Schema: [`schemas/v1/item-set.json`](https://github.com/isaacvarg/tomewise/blob/main/schemas/v1/item-set.json).

## Every item

| Key | Value |
| --- | --- |
| `id` | Lowercase letters, digits and single hyphens, unique across the subject: `letter-k` |
| `type` | One of the types below |
| `unlockedBy` | The lesson id whose completion makes the item reviewable; without it the item is unlocked from the start |
| `tags` | Strings drills and charts select by, such as `["letter"]` |
| `retired` | `true` to stop scheduling it |

## Types

| `type` | Also needs |
| --- | --- |
| `flashcard` | `front`, `back` |
| `multiple-choice` | `prompt`, `choices` (two or more), `answer` (one of the choices) |
| `typed-answer` | `prompt`, `answer`; optional `accept`: other answers to count correct |
| `timed-audio` | `answer`, and `audio` (a path from the subject folder, such as `assets/audio/k.wav`), `prompt`, or both; optional `timeLimitSeconds` |
| `routine` | `name`, `steps`: `[{ "text": "Hold the pose", "seconds": 30 }]` |

## Rules

- **An item's id is permanent.** History refers to it as `item:<id>`. When an item's meaning changes, set `retired: true` on it and add a new item with a new id; keep the retired one in the file.
- **One item per thing the learner recalls.** K and M are two items, even when one lesson teaches both.
- **Reuse tags** across sets so one drill or chart can span lessons.
- **Routines are never scheduled for review.** Their rhythm comes from a goal in `subject.json`.

Show an item in a lesson with its widget; see [WIDGETS.md](./WIDGETS.md). Run `tome validate` after editing; it reports duplicate ids and an `unlockedBy` that names no lesson.
