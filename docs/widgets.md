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
- Completing the lesson (`<tome-done>`, a `final` widget or `tome.complete()`) ends the session; later interaction starts no new one, so leaving posts no second `session.end`.

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
| `tome.complete()`          | Posts `lesson.completed` for the page's lesson in its session, then ends the session. Once per page: later calls resolve to the same event. Lesson pages only. |
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

## `<tome-done>`

| Attribute | Meaning                                  |
| --------- | ---------------------------------------- |
| `label`   | Button text; `Done` if absent            |

Marks the end of a lesson. Pressing the button calls `tome.complete()`: it posts `lesson.completed` (ref = the lesson) and `session.end`, then shows "Lesson complete" and disables itself. If the post fails, it shows the notice and stays pressable.

Keyboard: Tab to the button, Enter or Space. Touch: tap it.

```html
<tome-done>
  <div class="tome-done" data-state="ready | saving | done">
    <button class="tome-done-button">Done</button>
    <p class="tome-verdict" role="status">Lesson complete</p>   <!-- once done -->
    <p class="tome-notice" role="alert">…</p>                   <!-- failed save -->
  </div>
</tome-done>
```

### Final check

Instead of a Done button, mark one widget as the lesson's final check with the `final` attribute. When the learner completes it, the lesson is completed as if Done were pressed:

```html
<tome-flashcard ref="item:adios" final></tome-flashcard>
```

Completion is sent once per page, so a lesson may have both a `final` widget and `<tome-done>`. Widgets support `final` by calling `this.completed()` (from `TomeElement`) once their last attempt is saved.

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
