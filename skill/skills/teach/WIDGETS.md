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
- `<tome-audio>` without `choices` asks the learner to type. `payload` adds fixed fields the subject's payload schema requires (here `wpm`); the widget measures the rest. Every item widget takes `payload`.
- Drills and the built-in review have no page to carry `payload`. Put fixed fields in `subject.json` as `"drillPayload": { "wpm": 20 }`, or in a drill file as `"payload"` (it wins over `drillPayload`). Without them, a subject that requires a fixed field rejects every drill and review answer.
- `time-limit="<seconds>"` on any of the first four gives the learner that long; running out records a skip.

## The other widgets

| Tag                                                   | Use it to                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `<tome-done></tome-done>`                             | end a lesson: pressing it records the lesson as completed        |
| `final` on a `<tome-flashcard>`                       | complete the lesson when that last card is rated, without a Done button |
| `<tome-explain ref="lesson:0001-greetings" prompt="…">` | have the learner explain a concept in their own words, saved for you to grade |
| `<tome-timer seconds="90"></tome-timer>`              | count down a timed task; it records nothing                      |
| `<tome-drill drill="listen-kmrsu"></tome-drill>`      | run a drill file from `drills/`, or `drill="review"` for everything due |
| `<tome-drill items="hola adios" count="6"></tome-drill>` | run the named items one at a time, with no drill file            |

Every lesson ends in `<tome-done>` or a `final` widget, or the app never learns it was finished.

## Repetition is one drill

Practice over many rounds is one `<tome-drill>`, never the same item widget written out again and again. A dozen `<tome-audio>` tags in a row makes the learner scroll and click between answers and breaks the keyboard; a drill shows one item at a time with a count (`3 / 12`), plays the next sound by itself, replays a missed one and takes every answer from the keyboard.

This holds for every item type: six flashcards in a row are the same mistake as a dozen sounds.

- **A quick check on what was just taught** names its items in the page: `<tome-drill items="letter-k letter-m" count="4" format="multiple-choice" name="Tell them apart">`. `count` is how many to draw (each item once if left out), `format` is a drill format, `name` is the title in its bar, `time-limit` is seconds per item, and `payload` works as on a drill.
- **The lesson's main practice** runs its drill file: `<tome-drill drill="<id>">`. A drill in a lesson draws the items that lesson unlocks, before Done is pressed.
- **A single item widget** introduces one item, right after the teaching it belongs to. Each item gets at most one on a page.

`tome validate` fails a lesson with three or more item widgets in a row, or with the same item in more than one widget, and names the drill to write instead.

## Exam questions

On a quiz or exam page, write each question in the page and name the items it tests. A miss brings those items forward; the question itself is never scheduled.

```html
<tome-exam-question id="q1" tests="item:letter-k item:letter-r">
  <p>Which letter is dah-di-dah?</p>
  <tome-choice answer="K"><option>K</option><option>R</option><option>M</option></tome-choice>
</tome-exam-question>
```

Use `<tome-typed answer="…">` with `<option>`s for other accepted answers in place of `<tome-choice>`. To ask by sound, use `<tome-audio ref="item:<id>" choices="…">` instead; it measures what it hears. If the subject's payload schema requires fields, give the question a `payload` with the fixed ones (`payload='{"wpm":20}'`). A required field no control can measure or fix, such as Morse's `heard` on a `<tome-choice>`, gets the answer rejected, so pick a control that supplies it. Read [ASSESSMENTS-FORMAT.md](./ASSESSMENTS-FORMAT.md) before writing a quiz or exam page: where it goes, when it comes due, and how it is scored.

## Custom widgets

When no widget above fits, write one in the subject's `./assets/` as a plain JavaScript module:

1. `import { tome } from "/widgets/v1/tome.js";` and define a custom element with a name of the subject's own (`<morse-key>`, never `tome-…`), rendered without a shadow root.
2. On each answer, `await tome.attempt({ ref: "item:<id>", outcome: "correct" | "wrong" | "skipped", grade, duration, data }, this)`. Grade 3 for correct, 1 for wrong, or the learner's 1–4 rating. `duration` in ms. `data` must match the subject's payload schema; the app rejects anything else and the widget shows why.
3. For a final check, `await tome.complete(this)`; for an explanation, `await tome.explain(text, ref, this)`.
4. Style it with the theme's `.tome-*` classes (`tome-stage`, `tome-prompt`, `tome-input`, `tome-verdict`) and `var(--t-*)` tokens, so it matches the rest of the lesson.
5. Load it in the lesson: `<script type="module" src="../assets/morse-key.js"></script>`.

A custom widget is a small app the learner uses for minutes at a time, so build it to that standard:

- **One widget runs every round.** Give it the set to practise and a round count (`chars="KM" rounds="8"`), a Start button, a "Round 3 of 8" line and a summary with "Run again". Never put one tag per round on the page.
- **Keys work wherever focus is.** Listen for the widget's keys on `document` (capture phase) from Start until the last round, and only while the widget is on screen. A listener on the element alone does nothing until the learner clicks into it, and a pad that calls `preventDefault()` on `pointerdown` never takes focus at all. Call `preventDefault()` on the keys you handle so Space doesn't scroll the page or press another button, and leave keys typed into inputs alone.
- **Show what the learner did.** Draw their input as they make it and set it against the ideal afterwards: bars for keyed dits and dahs over the ideal timing, a waveform, a diff. A verdict in words alone teaches less than the picture.
- **Say how to improve.** Name what was off and by how much ("your dahs were short: 2.1 units, aim for 3"), and keep running numbers for the session in view.
- **Move on by itself.** After the verdict, start the next round after a short pause; don't make the learner press a key that the round also uses.
- **Try it.** Open the lesson in the app and run a full round by keyboard alone, starting with focus somewhere else on the page.

Widgets under `/widgets/v1/` only gain features, so a lesson written against them keeps working.
