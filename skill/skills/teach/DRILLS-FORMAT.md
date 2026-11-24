# Drills

A drill is a reusable practice session over a set of items, saved as `subjects/<subject>/drills/<id>.json`. The file name is the drill's id, so `drills/listen-kmrsu.json` runs as `<tome-drill drill="listen-kmrsu">` and is recorded as `drill:listen-kmrsu`.

- Worked example: [`drills/listen-kmrsu.json`](https://github.com/isaacvarg/tomewise/blob/main/examples/morse/subjects/morse-code/drills/listen-kmrsu.json) in the Morse example.
- JSON Schema: [`schemas/v1/drill.json`](https://github.com/isaacvarg/tomewise/blob/main/schemas/v1/drill.json).

## Structure

| Key | Value |
| --- | --- |
| `name` | What the learner sees |
| `select.from` | `due` for items the schedule says are due, `unlocked` for every unlocked item |
| `select.tags` | Only items with one of these tags; leave out for all |
| `count` | How many items a run draws; leave out for all that match |
| `format` | `item` to show each item as its own type, or one of `flashcard`, `multiple-choice`, `typed-answer`, `timed-audio` to show them all that way |
| `timeLimits` | `perItemSeconds`, `totalSeconds`, or both |

## Rules

- **`review` is built in.** It runs everything due; never write `drills/review.json`. App-built quizzes run as `drill:quiz-YYYY-MM-DD`, so leave that pattern unused too.
- **Select by tag**, so a drill grows as new lessons unlock more tagged items.
- **Drills are unscored**, but every attempt in one moves that item's review schedule. For a scored check, write a quiz; see [ASSESSMENTS-FORMAT.md](./ASSESSMENTS-FORMAT.md).

Run `tome validate` after editing; it reports a tag no unretired item carries.
