# Grading explanations

`<tome-explain>` saves the learner's own account of a concept as an `explanation.saved` event, ungraded. The subject home asks the learner to have you grade it until an `explanation.graded` names it; then it shows your feedback under the explanation. Both kinds are defined in [EVENTS-FORMAT.md](./EVENTS-FORMAT.md).

Grade after `git pull` and before planning, so the grades steer the lesson you plan.

## 1. Find the ungraded explanations

`tome query` aggregates payload fields and lists no events, so read the events themselves:

```sh
grep -h '"kind":"explanation\.' subjects/<subject>/events/*.jsonl
```

An `explanation.saved` is ungraded while no `explanation.graded` has `"ref":"event:<its id>"`.

Done when you hold the `id`, `ref` and `data.text` of every ungraded explanation, or know there are none.

## 2. Grade each one

Read `data.text` against what its `ref` names: the lesson in `lessons/<id>.html` or the item in `items/*.json`, and the sources they cite. Write the feedback:

- **A verdict first**: `Right.`, `Close.` or `Not yet.`
- **The missing piece, named**: the exact fact, step or distinction the explanation lacks or gets wrong, with the correct version beside it.
- **Short**: one to three sentences, in the terms of the lesson and `GLOSSARY.md`.
- **Graded on the text**: what the learner wrote, read literally.

The learner wrote "R is dit-dah-dit. It is K backwards." Feedback that names the gap:

> Close. R is dit-dah-dit and K is dah-di-dah, so R is K with dits and dahs swapped, not reversed. Reversed, R reads the same.

Done when every ungraded explanation has a verdict and names its missing piece, or is `Right.` with nothing missing.

## 3. Log each grade

```sh
tome log '{"subject":"morse-code","kind":"explanation.graded","ref":"event:01M6ERETN0YYARVDHJG0T15Q2K","schemaVersion":3,"data":{"feedback":"Close. R is dit-dah-dit and K is dah-di-dah, so R is K with dits and dahs swapped, not reversed. Reversed, R reads the same."}}'
```

- `ref` is `event:` plus the `explanation.saved` event's `id`.
- `schemaVersion` is the latest payload schema version in `subject.json`.
- `tome log` fills in `id` and `ts`.
- Feedback with an apostrophe breaks the single quotes: pipe the JSON in with `tome log -` instead.

`tome log` prints each problem and exits non-zero on a bad event; fix it and log again. When the app is unreachable it writes the event to `events/YYYY-MM.<machine>.jsonl`, which step 6 of the teaching session commits with the subject.

Done when `tome log` has exited 0 for every ungraded explanation.

## 4. Carry the grades forward

- **Learning records.** A `Right.` on something non-trivial is evidence of understanding: write a record, citing the `explanation.saved` id as its evidence. A `Close.` or `Not yet.` that shows a misconception becomes a record once a later explanation or answer shows it corrected. [LEARNING-RECORD-FORMAT.md](./LEARNING-RECORD-FORMAT.md) says when a record is due.
- **The next lesson.** Each missing piece is a target when you plan the lesson: open the lesson by retrieving it, practise it with a widget, and end with a fresh `<tome-explain>` on the same concept to check the fix.
- **The learner.** Tell them in a line each what you graded; the app shows the full feedback.
