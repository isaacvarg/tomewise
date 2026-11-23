# Widgets

Widgets are how lessons report results. The app serves them at `/widgets/v1/`: `tome.js` plus one module per widget. They are Lit components rendered in the light DOM (ADR 0005, 0013), so themes reach them.

Source lives in `widgets/src/`; `pnpm build:widgets` builds it into `app/widgets/v1/`, and `pnpm build` builds it into the packaged tool. Agents never build anything.

| Item type         | Widget             |
| ----------------- | ------------------ |
| `flashcard`       | `<tome-flashcard>` |
| `multiple-choice` | `<tome-choice>`    |
| `typed-answer`    | `<tome-typed>`     |
| `timed-audio`     | `<tome-audio>`     |
| `routine`         | `<tome-routine>`   |

Besides these: `<tome-timer>` (a countdown), `<tome-explain>` (an explanation saved for grading), `<tome-exam-question>` (on exam pages), `<tome-done>` (completes the lesson) and `<tome-drill>` (runs a drill or the review of everything due). A format none of them fits gets a [custom widget](#custom-widgets).

## Versions

Lessons load widgets from `/widgets/v1/`. Within v1, widgets only gain features: new widgets, attributes, `tome` members, classes and states may appear, but nothing a lesson or theme already relies on changes meaning or goes away. That covers tag names, attributes, the events a widget posts and their grades, the `tome` API, and the [theme contract](#theme-contract). A breaking change ships as `/widgets/v2/`, served alongside v1, so old lessons keep working.

## On a page

The app injects `tome.js` and the page context into every lesson's `<head>`. A lesson only needs the tags:

```html
<tome-flashcard ref="item:hola"></tome-flashcard>
```

`tome.js` finds the widget tags on the page, including ones added later, and loads each widget's module once.

### Page context

`tome.js` reads the page from `<meta>` tags the app writes:

| Meta             | Content                                  |
| ---------------- | ---------------------------------------- |
| `tome-subject`   | subject id                               |
| `tome-page-kind` | `lesson`, `quiz`, `exam` or `drill`; `lesson` if absent |
| `tome-<kind>`    | page id (file name, no extension), e.g. `tome-quiz` |

The session ref is `<kind>:<id>`, such as `quiz:week-1`. A page with no context posts nothing.

## Sessions

- Loading a page posts nothing.
- The first `pointerdown` or `keydown` on the page posts `session.start` with `ref` set to the page (`lesson:0001-greetings`). So does the first attempt, if it comes first.
- `pagehide` posts `session.end` with the session's duration in whole ms, through `navigator.sendBeacon`. Attempts are posted as they happen, so a crash keeps them.
- A page restored from the back/forward cache starts a new session on its next interaction.
- Completing the lesson (`<tome-done>`, a `final` widget or `tome.complete()`) ends the session; later interaction starts no new one, so leaving posts no second `session.end`.

## The `tome` API

Custom widgets in a subject's `assets/` import it:

```js
import { tome } from "/widgets/v1/tome.js";

await tome.attempt({ ref: "item:letter-k", outcome: "correct", grade: 3, duration: 1210, data: { heard: "K" } });
```

| Member                     | Does                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tome.attempt(input, widget?)` | Posts one attempt in the page's session, starting it if needed. Resolves to the stored event. Pass the widget element to get the failure notice in it. |
| `tome.explain(text, ref, widget?)` | Posts `explanation.saved` for `ref` (`lesson:<id>` or `item:<id>`) with the trimmed text as `data.text`, ungraded. Rejects empty text. |
| `tome.item(ref)`           | Resolves to the item for `item:<id>` from the subject's item sets.                                     |
| `tome.subject()`           | Resolves to the subject as `/api/subjects/:subject` returns it.                                       |
| `tome.due()`               | Resolves to the items due today, most overdue first.                                                   |
| `tome.unlocked()`          | Resolves to the unretired items whose lesson is completed, or that need none.                          |
| `tome.complete(widget?)`   | Posts `lesson.completed` for the page's lesson in its session, then ends the session. Once per page: later calls resolve to the same event. Lesson pages only. |
| `tome.start()`, `tome.end()` | Start or end the page's session by hand. Widgets rarely need these. `end()` returns `{ sessionId, duration }` for the session it ended, or `undefined` if none was open. |
| `tome.context`, `tome.page`  | The page context, and its ref (`lesson:<id>`).                                                         |

`attempt` takes `ref`, `outcome` (`correct`, `wrong`, `skipped`), `grade` (1–4), `duration` (ms, rounded to whole ms) and `data` (the payload; validated against the subject's newest payload schema version). Events carry that version as `schemaVersion`.

Failures reject with a `TomeError` whose `message` is fit to show the learner: the app can't be reached, or it rejected the event (`issues` lists why). There is no offline queue (ADR 0004): nothing is queued or retried.

When `attempt`, `explain` or `complete` is given the widget element, a failure appends a notice as the widget's last child, and the widget's next post through any of them removes it. Every built-in widget passes itself:

```html
<p class="tome-notice" role="alert" data-state="unsaved">Couldn't reach the app, so this wasn't saved. …</p>
```

The widget keeps the learner's answer on screen and lets them try again.

## Custom widgets

A format no built-in widget fits gets its own widget in the subject's `assets/`: a plain ES module, no build step. It reports through `tome.js`, so its events pass the same validation as the built-ins'.

1. Import `tome` from `/widgets/v1/tome.js`. The app has already loaded it on the page, so the import shares the page's context and session.
2. Define a custom element named for the subject, such as `<morse-key>`. The `tome-` prefix belongs to built-in widgets. Render into the element itself (light DOM, no shadow root), reusing built-in classes where they fit (`.tome-stage`, `.tome-prompt`, `.tome-input`, `.tome-verdict`, …) and styling the rest with `--t-*` tokens, so the theme reaches it.
3. Post one `tome.attempt({ ref, outcome, grade, duration, data }, this)` per answer. Grade as the built-ins do: 1 wrong, 3 correct, or the learner's 1–4 rating. `data` follows the subject's newest payload schema for `attempt`; the app rejects an event that doesn't match, and the rejection's message names the field.
4. Pass the element as the last argument of `attempt`, `explain` and `complete`, so a failed save shows the unsaved notice inside it. When the promise rejects, keep the learner's answer on screen.
5. Call `tome.complete(this)` if the widget is the lesson's final check, and `tome.explain(text, ref, this)` to save an explanation.

The lesson loads the module and uses the tag. Below it, the widget's answer handler, abridged (rendering, item loading and the verdict left out):

```html
<script type="module" src="../assets/morse-key.js"></script>
<morse-key ref="item:letter-k" pattern="-.-" wpm="20" final></morse-key>
```

```js
import { tome } from "/widgets/v1/tome.js";

class MorseKey extends HTMLElement {
  async #answer(given) {
    const responseTime = Math.round(performance.now() - this.#shownAt);
    const correct = given.trim().toUpperCase() === this.#item.answer;
    const saved = await tome
      .attempt(
        {
          ref: this.getAttribute("ref"),
          outcome: correct ? "correct" : "wrong",
          grade: correct ? 3 : 1,
          duration: responseTime,
          data: { heard: this.#item.answer, answer: given.trim(), responseTime, wpm: Number(this.getAttribute("wpm")) },
        },
        this,
      )
      .catch(() => undefined);
    if (!saved) return;
    if (this.hasAttribute("final")) await tome.complete(this).catch(() => undefined);
  }
}

customElements.define("morse-key", MorseKey);
```

The full widget is `widgets/test/fixtures/subjects/morse-code/assets/morse-key.js`; `widgets/test/custom-widget.test.ts` runs it in the Morse subject.

## `<tome-flashcard>`

| Attribute | Meaning                                  |
| --------- | ---------------------------------------- |
| `ref`     | `item:<id>` of a `flashcard` item        |

Shows the item's `front`. "Show answer" reveals `back` and asks Again / Hard / Good / Easy. The rating is the grade (1–4); Again is `wrong`, the rest `correct`. One attempt is posted per card, timed from when the card first scrolled into view.

Keyboard: Tab to "Show answer", Enter or Space to reveal; focus moves to Good; keys 1–4 rate. Touch: tap the buttons.

### Markup

```html
<tome-flashcard ref="item:hola">
  <div class="tome-flashcard" data-state="front | back | saving | saved | loading | error">
    <div class="tome-stage">
      <p class="tome-front">hola</p>
      <p class="tome-back">hello</p>                       <!-- once revealed -->
    </div>
    <button class="tome-reveal">Show answer</button>      <!-- before reveal -->
    <div class="tome-grades" role="group">                <!-- after reveal -->
      <button class="tome-grade" data-grade="1..4" data-state="chosen">Again<kbd>1</kbd></button>
    </div>
    <p class="tome-verdict" data-state="correct | wrong | skipped">Saved: Good</p>
    <p class="tome-hint">Loading…</p>                      <!-- loading, alone -->
    <p class="tome-notice" role="alert">…</p>             <!-- unknown item -->
  </div>
  <p class="tome-notice" role="alert" data-state="unsaved">…</p>  <!-- failed save -->
</tome-flashcard>
```

## `<tome-choice>` and `<tome-typed>`

| Widget          | `ref` names                  | Learner                                             |
| --------------- | ---------------------------- | --------------------------------------------------- |
| `<tome-choice>` | a `multiple-choice` item     | picks one of `choices`                              |
| `<tome-typed>`  | a `typed-answer` item        | types an answer; it matches `answer` or any of `accept` |

Both show the item's `prompt`, grade the answer themselves and post one attempt as soon as it's given: correct is grade 3, wrong is grade 1. Skip posts a `skipped` attempt with grade 1. The verdict then shows, with the right answer when the learner missed or skipped. Typed answers match ignoring case, leading and trailing spaces and repeated spaces; accents count. Duration is timed from when the widget first scrolled into view.

Keyboard: in `<tome-choice>`, keys 1–9 pick a choice while focus is in the widget; Tab and Enter work too. In `<tome-typed>`, Enter submits. Touch: tap.

If the save fails, the answer and verdict stay on screen with the notice and a "Save again" button that posts the same attempt.

### Markup

```html
<tome-choice ref="item:rojo">
  <div class="tome-choice" data-state="ready | saving | failed | saved | loading | error">
    <div class="tome-stage"><p class="tome-prompt">Which word means red?</p></div>
    <div class="tome-answers" role="group">
      <button class="tome-answer" data-state="correct | wrong | faded">rojo<kbd>2</kbd></button>
    </div>
    <button class="tome-skip">Skip</button>                       <!-- before answering -->
    <div class="tome-feedback" aria-live="polite">
      <p class="tome-verdict" data-state="correct | wrong | skipped">Not quite · the answer is rojo</p>
    </div>
    <button class="tome-retry">Save again</button>                <!-- failed save -->
    <p class="tome-notice" role="alert">…</p>                     <!-- wrong item -->
    <p class="tome-hint">Loading…</p>                             <!-- loading, alone -->
  </div>
  <p class="tome-notice" role="alert" data-state="unsaved">…</p>  <!-- failed save -->
</tome-choice>

<tome-typed ref="item:gracias">
  <div class="tome-typed" data-state="…as above">
    <div class="tome-stage"><p class="tome-prompt">Say thank you</p></div>
    <form class="tome-entry">
      <input class="tome-input" data-state="correct | wrong">
      <button class="tome-submit">Check</button>
    </form>
    <!-- .tome-skip, .tome-feedback, .tome-retry, .tome-notice as above -->
  </div>
  <!-- unsaved .tome-notice as above -->
</tome-typed>
```

`data-state` on `.tome-answer` and `.tome-input` is set only after answering.

## `<tome-audio>`

| Attribute | Meaning                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| `ref`     | `item:<id>` of a `timed-audio` item                                                           |
| `choices` | Optional. Space-separated answers to pick from, e.g. `choices="K M R S U"`. Without it, the learner types the answer. |
| `payload` | Optional. JSON object of fixed payload fields, e.g. `payload='{"wpm":20}'`.                    |

```html
<tome-audio ref="item:letter-k" choices="K M R S U" payload='{"wpm":20}'></tome-audio>
```

The play button plays the item's `audio` (served from the subject, e.g. `assets/audio/k.wav`). An item with only a `prompt` shows a Start button instead, and the prompt appears once started. The answers unlock when the sound has finished; the response time and the item's `timeLimitSeconds` count from then. The play button replays at any time.

Answers are compared trimmed and ignoring case. Correct is grade 3, wrong is grade 1. `duration` is the response time in whole ms.

**Running out of time** posts the attempt with outcome `skipped`, grade 1 and an empty answer. Grade 1 because not answering in time means the item isn't known at speed, so the scheduler should bring it back soon. `skipped` rather than `wrong` so stats can tell a timeout from a confusion (K heard as M).

**Payload.** The widget measures `heard` (the item's answer), `answer` (what the learner gave, `""` on timeout), `responseTime` (ms) and `replays` (plays after the first, before answering). It attaches each of these that the subject's newest payload schema declares for `attempt`, then the `payload` attribute's fields. For the Morse subject that gives `{ heard, answer, responseTime, wpm }`. The server validates the result like any other event; if it rejects it, the widget shows the reason and a "Save again" button, and keeps the answer on screen.

Keyboard: Tab to the play button, Enter or Space to play; Space replays while focus is in the widget (outside the answer field). With single-character choices, that character's key answers (`k`); with longer choices, keys 1–9. Without choices, focus moves to the answer field and Enter answers. Touch: tap the buttons.

### Markup

```html
<tome-audio ref="item:letter-k" choices="K M">
  <div class="tome-audio" data-state="ready | listening | answering | saving | saved | unsaved | loading | error">
    <div class="tome-stage">
      <button class="tome-play" data-playing>…</button>   <!-- data-playing while sound plays -->
      <p class="tome-prompt">…</p>                          <!-- prompt items, once started -->
      <p class="tome-hint">Tap to play · <kbd>Space</kbd></p>
      <div class="tome-countdown"><span></span></div>       <!-- while answering, if there is a time limit -->
      <div class="tome-feedback" aria-live="polite">
        <p class="tome-say">K</p>                           <!-- once answered -->
        <p class="tome-verdict" data-state="correct | wrong | skipped">Right · 0.82 s</p>
      </div>
    </div>
    <div class="tome-answers" role="group">                 <!-- with choices -->
      <button class="tome-answer" data-choice="K" data-state="correct | wrong | faded"><b>K</b><kbd>k</kbd></button>
    </div>
    <form class="tome-respond">                             <!-- without choices -->
      <input class="tome-input"><button class="tome-submit">Answer</button>
    </form>
    <button class="tome-retry">Save again</button>          <!-- after a failed save -->
    <p class="tome-notice" role="alert">…</p>             <!-- unknown item, sound won't play -->
  </div>
  <p class="tome-notice" role="alert" data-state="unsaved">…</p>  <!-- failed save -->
</tome-audio>
```

## `<tome-routine>`

| Attribute | Meaning                                  |
| --------- | ---------------------------------------- |
| `ref`     | `item:<id>` of a `routine` item          |

Shows the routine's `name` and a Start button. Start shows the first step; Next moves on, and the last step's button is Finish. A step with `seconds` shows a `<tome-timer>` that starts on its own; the learner can move on before it's done. Finish asks Again / Hard / Good / Easy, as on a flashcard: the rating is the grade (1–4), Again is `wrong`, the rest `correct`. One attempt is posted, with `duration` from Start to Finish.

Leaving midway posts no attempt. The session still ends with its time, but an unfinished routine has no rating to record, and routines skip the scheduler, so a `skipped` attempt would say nothing.

Keyboard: Tab to Start, Enter or Space to start; focus stays on Next, and Enter or → advances; on Finish focus moves to Good and keys 1–4 rate. Touch: tap the buttons.

### Markup

```html
<tome-routine ref="item:warm-up">
  <div class="tome-routine" data-state="ready | step | rate | saving | saved | loading | error">
    <p class="tome-routine-name">Warm-up</p>
    <p class="tome-progress">Step 2 of 3</p>              <!-- "3 steps" before Start, "How did it go?" when rating -->
    <button class="tome-start">Start</button>             <!-- before Start -->
    <div class="tome-stage">                              <!-- during steps -->
      <p class="tome-step">Hold the rolled r</p>
      <tome-timer seconds="20" autostart>…</tome-timer>   <!-- timed steps -->
    </div>
    <button class="tome-next">Next | Finish</button>       <!-- during steps -->
    <div class="tome-grades" role="group">                <!-- after Finish -->
      <button class="tome-grade" data-grade="1..4" data-state="chosen">Again<kbd>1</kbd></button>
    </div>
    <p class="tome-verdict" data-state="correct | wrong">Saved: Good</p>
    <p class="tome-hint">Loading…</p>                      <!-- loading, alone -->
    <p class="tome-notice" role="alert">…</p>             <!-- unknown item -->
  </div>
  <p class="tome-notice" role="alert" data-state="unsaved">…</p>  <!-- failed save -->
</tome-routine>
```

## `<tome-timer>`

| Attribute   | Meaning                                         |
| ----------- | ----------------------------------------------- |
| `seconds`   | Length in seconds (may be fractional)           |
| `autostart` | Start counting as soon as it's shown            |

A countdown, usable on its own in a lesson or inside `<tome-routine>`. Start counts down; Pause and Resume hold and continue it; Reset goes back to the full time. At zero it shows "Time's up" and dispatches a bubbling `tome-timer-done` event. It posts nothing.

Keyboard: Tab to the buttons, Enter or Space to press. Touch: tap them.

### Markup

```html
<tome-timer seconds="90">
  <div class="tome-timer" data-state="idle | running | paused | done | error">
    <p class="tome-clock" role="timer">1:30</p>
    <div class="tome-timer-controls">
      <button class="tome-timer-toggle">Start | Pause | Resume</button>   <!-- not when done -->
      <button class="tome-timer-reset">Reset</button>                     <!-- once started -->
    </div>
    <p class="tome-verdict" role="status">Time's up</p>                   <!-- when done -->
    <p class="tome-notice" role="alert">…</p>                             <!-- missing or invalid seconds -->
  </div>
</tome-timer>
```

## `<tome-explain>`

| Attribute | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `ref`     | the concept explained: `lesson:<id>` or `item:<id>`            |
| `prompt`  | the question above the text box; "Explain it in your own words." if absent |

The learner writes a plain-language explanation and saves it for the agent to grade later. Saving posts `explanation.saved` with `data: { text }` (trimmed) through `tome.explain`. Save is disabled while the text is blank. Editing after a save allows saving again, which posts a new event. On failure the text stays and a notice shows.

`data.text` is checked by the app for every subject; a subject's payload schema may add fields to `explanation.saved` but not drop `text`.

The agent grades an explanation with an `explanation.graded` event whose `ref` is `event:<id>` of the `explanation.saved` and whose `data.feedback` holds what it says to the learner. `data.feedback` is checked the same way as `data.text`. Until a grade arrives, the subject home asks the learner to have their agent grade it; after, it shows the feedback under the explanation.

Keyboard: Tab into the text box, Ctrl+Enter (⌘+Enter) saves. Touch: tap Save explanation.

### Markup

```html
<tome-explain ref="lesson:0001-greetings" prompt="Why do we say hola?">
  <div class="tome-explain" data-state="editing | saving | saved">
    <label class="tome-prompt">Why do we say hola?</label>
    <textarea class="tome-explain-text"></textarea>
    <div class="tome-actions">
      <button class="tome-save">Save explanation</button>
      <p class="tome-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves</p>   <!-- until saved -->
      <p class="tome-verdict" role="status">Saved for grading</p>        <!-- once saved -->
    </div>
  </div>
  <p class="tome-notice" role="alert" data-state="unsaved">…</p>  <!-- failed save -->
</tome-explain>
```

## `<tome-exam-question>`

An exam question on an exam page. Write the question inside the tag, then one `<tome-choice>` or `<tome-typed>` whose answer is written in the page instead of coming from an item: `answer` holds the right answer, and `<option>` children hold the choices (`<tome-choice>`) or other accepted answers (`<tome-typed>`).

```html
<tome-exam-question id="q1" tests="item:letter-k item:letter-r">
  <p>Which letter is dah-di-dah?</p>
  <tome-choice answer="K"><option>K</option><option>R</option><option>M</option></tome-choice>
</tome-exam-question>

<tome-exam-question id="q2" tests="item:gracias">
  <p>Thank someone warmly.</p>
  <tome-typed answer="muchas gracias"><option>mil gracias</option></tome-typed>
</tome-exam-question>
```

`id` names the question within the exam and `tests` lists the items it tests. The answer is graded as in `<tome-choice>` and `<tome-typed>`, then posted as one attempt per tested item: `ref` is the item, the outcome, grade and duration are the same for each, and `data.question` is the question's `id`. A miss is a wrong attempt on each of those items, so they come due sooner. The exam question itself is never scheduled. On an exam page the session's `ref` is the exam.

`question` is reserved in attempt payloads for this id, so a subject's payload schema can't define an attempt field with that name.

A question with no `id`, no `tests`, an unknown item in `tests` or no answer control shows a notice and can't be answered. If a save fails, "Save again" posts only the attempts that didn't save. Keyboard and touch work as in the answer control.

### Markup

```html
<tome-exam-question id="q1" tests="…">
  <div class="tome-exam-question" data-state="loading | error | ready | answered">
    <div class="tome-question">
      <p>Which letter is dah-di-dah?</p>              <!-- the page's own markup -->
      <tome-choice answer="K">…</tome-choice>         <!-- no stage: the question is the prompt -->
    </div>
    <p class="tome-notice" role="alert">…</p>         <!-- missing id, tests or answer; unknown items -->
  </div>
  <p class="tome-notice" role="alert" data-state="unsaved">…</p>  <!-- failed save -->
</tome-exam-question>
```

## `<tome-done>`

| Attribute | Meaning                                  |
| --------- | ---------------------------------------- |
| `label`   | Button text; `Done` if absent            |

Marks the end of a lesson. Pressing the button calls `tome.complete(this)`: it posts `lesson.completed` (ref = the lesson) and `session.end`, then shows "Lesson complete" and disables itself. If the post fails, it shows the notice and stays pressable.

Keyboard: Tab to the button, Enter or Space. Touch: tap it.

```html
<tome-done>
  <div class="tome-done" data-state="ready | saving | done">
    <button class="tome-done-button">Done</button>
    <p class="tome-verdict" role="status">Lesson complete</p>   <!-- once done -->
  </div>
  <p class="tome-notice" role="alert" data-state="unsaved">…</p>  <!-- failed save -->
</tome-done>
```

### Final check

Instead of a Done button, mark the lesson's final check with the `final` attribute. When the learner completes it, the lesson is completed as if Done were pressed. In v1, `<tome-flashcard>` takes `final`; so can a [custom widget](#custom-widgets), by calling `tome.complete(this)`.

```html
<tome-flashcard ref="item:adios" final></tome-flashcard>
```

Completion is sent once per page, so a lesson may have both a `final` widget and `<tome-done>`. A built-in widget supports `final` by calling `this.completed()` (from `TomeElement`) once its last attempt is saved; a failed completion shows the unsaved notice in that widget.

## Item widgets in sequence

`<tome-flashcard>`, `<tome-choice>`, `<tome-typed>` and `<tome-audio>` share two features, which `<tome-drill>` relies on.

- **`time-limit="<seconds>"`** gives the learner that long to answer. It counts from when the widget first scrolled into view, or for `<tome-audio>` from when the sound finished (the tighter of `time-limit` and the item's `timeLimitSeconds` applies). Running out posts a `skipped` attempt with grade 1, as `<tome-audio>` does.
- **`tome-answered`.** Once an attempt is saved, the widget dispatches a bubbling `tome-answered` event with `detail: { ref, outcome, grade, duration }`.

`<tome-audio>` also has a `play()` method, which starts the sound as the play button does.

## `<tome-drill>`

| Attribute | Meaning                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `drill`   | Optional. Drill id: a file in the subject's `drills/` (no extension), or `review`. Defaults to the page's id on a drill page, else `review`. |
| `payload` | Optional. JSON object passed to each item widget as its `payload`, e.g. `payload='{"wpm":20}'`.          |
| `close`   | Optional. Address for an "End session" link (`.tome-close`, ×) at the start of the bar, e.g. `close="/"`. |

```html
<tome-drill drill="listen-kmrsu" payload='{"wpm":20}'></tome-drill>
```

Runs a drill as a sequence of the item widgets, one item at a time. `review` is the built-in "review everything due".

- **Selection.** `select.from: "due"` takes the items the schedule says are due, most overdue first. `"unlocked"` takes every unretired item with no `unlockedBy` or whose lesson is completed, shuffled. With `select.tags`, an item needs at least one of them. `count` caps the run; an unlocked pool smaller than `count` is drawn again in fresh shuffled rounds, so each item comes up about equally (12 sounds from 3 letters). Due items never repeat. Routine items are left out.
- **Format.** Each item is shown in its own widget (`flashcard` → `<tome-flashcard>`, `multiple-choice` → `<tome-choice>`, `typed-answer` → `<tome-typed>`, `timed-audio` → `<tome-audio>`). In a `multiple-choice` drill, timed-audio items get the run's distinct answers as `choices` (K M R); in other formats they are typed. A format an item can't take falls back to its own type.
- **Time limits.** `timeLimits.perItemSeconds` is each widget's `time-limit`. `timeLimits.totalSeconds` starts at the learner's first tap or key press in the drill; when it runs out the run ends and the item on screen posts nothing.
- **Attempts and session.** Each answer posts one attempt on its item, through the item widget, so every attempt updates that item's schedule. The session is the page's: on a drill page (`tome-page-kind` `drill`, `tome-drill` the drill id) its ref is `drill:<id>`. Finishing the run posts `session.end`; "Run again" selects afresh and starts a new session.
- **Pace.** After an answer the drill moves on by itself (0.9 s when right, 1.6 s otherwise), or at once with Next. From the second item on, audio items play by themselves.
- **End.** The summary shows the score, right out of answered, median answer time, how many were skipped or out of time, and the missed items. A selection with nothing in it shows an empty state instead.
- **Hosting.** When the run ends, after `session.end`, the drill dispatches `tome-drill-done` (bubbles, cancelable) with `detail` `{ drill, planned, timeUp, results, session }`: `results` holds one `{ ref, outcome, grade, duration }` per answer, `planned` is how many items the run had, and `session` is what `tome.end()` returned. A host that calls `preventDefault()` shows its own summary; the drill then keeps only its bar and progress. The dashboard's runner does this.

A failed save keeps the item on screen with its notice (inside the item widget) and "Save again"; the drill waits for it.

Keyboard: focus moves into each new item (the play button, the first choice, the answer field or "Show answer"), so the item's own keys work; after answering, focus is on Next, so Enter moves on; at the end, focus is on "Run again". Touch: tap.

### Markup

```html
<tome-drill drill="listen-kmrsu">
  <div class="tome-drill" data-state="running | done | empty | loading | error">
    <header class="tome-drill-bar">
      <a class="tome-close" href="/" aria-label="End session">×</a>        <!-- with close -->
      <div class="tome-drill-title">
        <span class="tome-kicker">Morse code</span>
        <span class="tome-drill-name">Listen · K M R S U</span>
      </div>
      <span class="tome-clock" role="timer" data-state="low">0:42</span>   <!-- with timeLimits.totalSeconds -->
      <span class="tome-count">3 / 12</span>
    </header>
    <div class="tome-progress" role="progressbar"><span style="width: 25%"></span></div>
    <div class="tome-drill-item"><tome-audio …></tome-audio></div>        <!-- running -->
    <div class="tome-drill-next"><button class="tome-next">Next</button></div>   <!-- once answered -->
    <section class="tome-summary">                                          <!-- done -->
      <div class="tome-summary-head">
        <span class="tome-kicker">Drill done | Time's up</span>
        <span class="tome-score">75%</span>
        <span class="tome-score-sub">9 of 12 right</span>
      </div>
      <ul class="tome-stats"><li><span>Median answer time</span><span>0.84 s</span></li></ul>
      <p class="tome-saved">…</p>
      <div class="tome-actions"><button class="tome-again">Run again</button></div>
    </section>
    <div class="tome-empty" role="status">                                  <!-- empty -->
      <p class="tome-empty-title">Nothing is due</p>
      <p class="tome-hint">…</p>
    </div>
    <p class="tome-notice" role="alert">…</p>                               <!-- unknown drill, can't load -->
  </div>
</tome-drill>
```

## Theme contract

Themes reach widgets through tag names, the classes and `data-*` states each widget renders, and the `--t-*` tokens its base styles read. All three are part of the theme contract and follow the [v1 rule](#versions). Each widget's section above shows its markup and states. [docs/themes.md](./themes.md) has the full lists and the shared conventions.

Base styles sit in the `tome.widgets` cascade layer, so any theme rule wins, and use only `--t-*` tokens: no literal colours, fonts or radii. `widgets/test/theme-contract.test.ts` checks the lists and the markup blocks above against the widget source.

## Browser tests

`widgets/test/` runs widgets in a real page: `startWidgetApp()` (`widgets/test/browser.ts`) builds the widgets, starts the app on a copy of the Morse example plus the fixture subjects in `widgets/test/fixtures/`, and opens a Playwright Chromium page. Tests interact as a learner and assert on the events written to disk. They run with `pnpm test`.

They need Chromium for the pinned `playwright` version:

```sh
pnpm exec playwright install chromium
```

On NixOS, use nixpkgs' build instead (keep `playwright` in `package.json` at nixpkgs' `playwright-driver` version):

```sh
export PLAYWRIGHT_BROWSERS_PATH=$(nix build --no-link --print-out-paths nixpkgs#playwright-driver.browsers-chromium)
```
