# Widgets

Widgets are how lessons report results. The app serves them at `/widgets/v1/`: `tome.js` plus one module per widget. They are Lit components rendered in the light DOM (ADR 0005, 0013), so themes reach them. Within `v1` they only gain features.

Source lives in `widgets/src/`; `pnpm build:widgets` builds it into `app/widgets/v1/`, and `pnpm build` builds it into the packaged tool. Agents never build anything.

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

## The `tome` API

Custom widgets in a subject's `assets/` import it:

```js
import { tome } from "/widgets/v1/tome.js";

await tome.attempt({ ref: "item:letter-k", outcome: "correct", grade: 3, duration: 1210, data: { heard: "K" } });
```

| Member                     | Does                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tome.attempt(input)`      | Posts one attempt in the page's session, starting it if needed. Resolves to the stored event.         |
| `tome.item(ref)`           | Resolves to the item for `item:<id>` from the subject's item sets.                                     |
| `tome.subject()`           | Resolves to the subject as `/api/subjects/:subject` returns it.                                       |
| `tome.start()`, `tome.end()` | Start or end the page's session by hand. Widgets rarely need these.                                   |
| `tome.context`, `tome.page`  | The page context, and its ref (`lesson:<id>`).                                                         |

`attempt` takes `ref`, `outcome` (`correct`, `wrong`, `skipped`), `grade` (1–4), `duration` (ms, rounded to whole ms) and `data` (the payload; validated against the subject's newest payload schema version). Events carry that version as `schemaVersion`.

Failures reject with a `TomeError` whose `message` is fit to show the learner: the app can't be reached, or it rejected the event (`issues` lists why). There is no offline queue (ADR 0004); show the message and keep the learner's answer on screen.

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
    <p class="tome-verdict" data-state="correct | wrong">Saved: Good</p>
    <p class="tome-notice" role="alert">…</p>             <!-- unknown item, failed save -->
  </div>
</tome-flashcard>
```

These class names, `data-*` states and this structure are part of the theme contract.

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
    <p class="tome-notice" role="alert">…</p>             <!-- unknown item, failed save -->
  </div>
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

## Styling

Widgets ship base styles in the `tome.widgets` cascade layer, so any theme rule wins. Base styles use only `--t-*` tokens: `--t-bg`, `--t-surface`, `--t-ink`, `--t-muted`, `--t-rule`, `--t-accent`, `--t-accent-ink`, `--t-good`, `--t-good-bg`, `--t-bad`, `--t-bad-bg`, `--t-display`, `--t-ui`, `--t-mono`, `--t-radius`.

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
