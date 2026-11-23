# Widgets

Widgets are how a lesson reports what the learner did. Each answer a widget records becomes an event in the learner's history and moves the review schedule, so every practice and check in a lesson goes through one. The app serves them and loads them on every page; write the tag and nothing else.

## One widget per item type

Define the item once in the subject's `items/`, then name it by ref:

| Item type         | Tag                                                                 |
| ----------------- | ------------------------------------------------------------------- |
| `flashcard`       | `<tome-flashcard ref="item:hola"></tome-flashcard>`                 |
| `multiple-choice` | `<tome-choice ref="item:rojo"></tome-choice>`                       |
| `typed-answer`    | `<tome-typed ref="item:gracias"></tome-typed>`                      |
| `timed-audio`     | `<tome-audio ref="item:letter-k" choices="K M R" payload='{"wpm":20}'></tome-audio>` |
| `routine`         | `<tome-routine ref="item:warm-up"></tome-routine>`                  |

- Flashcards and routines are self-rated Again / Hard / Good / Easy; the others grade themselves.
- `<tome-audio>` without `choices` asks the learner to type. `payload` adds fixed fields the subject's payload schema requires (here `wpm`); the widget measures the rest.
- `time-limit="<seconds>"` on any of the first four gives the learner that long; running out records a skip.

## The other widgets

| Tag                                                   | Use it to                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `<tome-done></tome-done>`                             | end a lesson: pressing it records the lesson as completed        |
| `final` on a `<tome-flashcard>`                       | complete the lesson when that last card is rated, without a Done button |
| `<tome-explain ref="lesson:0001-greetings" prompt="…">` | have the learner explain a concept in their own words, saved for you to grade |
| `<tome-timer seconds="90"></tome-timer>`              | count down a timed task; it records nothing                      |
| `<tome-drill drill="listen-kmrsu"></tome-drill>`      | run a drill file from `drills/`, or `drill="review"` for everything due |

Every lesson ends in `<tome-done>` or a `final` widget, or the app never learns it was finished.

## Exam questions

On an exam page, write each question in the page and name the items it tests. A miss brings those items forward; the question itself is never scheduled.

```html
<tome-exam-question id="q1" tests="item:letter-k item:letter-r">
  <p>Which letter is dah-di-dah?</p>
  <tome-choice answer="K"><option>K</option><option>R</option><option>M</option></tome-choice>
</tome-exam-question>
```

Use `<tome-typed answer="…">` with `<option>`s for other accepted answers in place of `<tome-choice>`.

End every exam with `<tome-done></tome-done>`: it reads "Finish exam" and shows the score as the learner's score display setting says. The app scores the session over every question on the page and records it as `score` on the exam's `session.end`, even when the score is hidden from the learner. A score at or above the pass mark (the milestone's `passMark`, else the subject's) marks the milestone that names the exam done; a fail changes nothing. To go over results, read the latest `session.end` with `ref` `exam:<id>` and its session's attempts (`data.question` names the question).

## Written quizzes

Write a quiz in `quizzes/` together with the lesson after which it comes due, and name that lesson in the quiz's `<head>`:

```html
<meta name="tome-after" content="lesson:0002-r">
```

The quiz fills the first quiz slot that opens once that lesson is completed, so the learner gets it instead of the app-built one. Until it is taken it carries to later slots; once taken it fills none. Build it from `<tome-exam-question>`s (and item widgets if you like) and end it with `<tome-done></tome-done>`, which reads "Finish quiz". The app scores the session against the subject's `passMark` and records it as `score` on the `session.end` with `ref` `quiz:<id>`.

## Custom widgets

When no widget above fits, write one in the subject's `./assets/` as a plain JavaScript module:

1. `import { tome } from "/widgets/v1/tome.js";` and define a custom element with a name of the subject's own (`<morse-key>`, never `tome-…`), rendered without a shadow root.
2. On each answer, `await tome.attempt({ ref: "item:<id>", outcome: "correct" | "wrong" | "skipped", grade, duration, data }, this)`. Grade 3 for correct, 1 for wrong, or the learner's 1–4 rating. `duration` in ms. `data` must match the subject's payload schema; the app rejects anything else and the widget shows why.
3. For a final check, `await tome.complete(this)`; for an explanation, `await tome.explain(text, ref, this)`.
4. Style it with the theme's `.tome-*` classes (`tome-stage`, `tome-prompt`, `tome-input`, `tome-verdict`) and `var(--t-*)` tokens, so it matches the rest of the lesson.
5. Load it in the lesson: `<script type="module" src="../assets/morse-key.js"></script>`.

Widgets under `/widgets/v1/` only gain features, so a lesson written against them keeps working.
