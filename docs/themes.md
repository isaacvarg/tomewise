# Themes

A theme is the look of the app, its widgets and every lesson (ADR 0012). The learner picks one in `tomewise.json`, and it can change anything about appearance, layout included. Tomewise ships two: Paper (calm, bookish) and Meadow (playful, nature).

This page is theme contract v1: what a theme folder holds, how the app loads it, and the tokens and class names a theme can rely on. Within v1 the contract only grows; nothing listed here changes meaning or goes away.

## Choosing a theme

```json
{ "formatVersion": 1, "theme": "meadow" }
```

`theme` is a folder name and defaults to `paper`. The app looks for it in the learning home's `themes/<name>/` first, then in the tool's built-in themes, so a folder in your learning home overrides a built-in theme of the same name. If neither has it, the app uses Paper and prints a warning. The app follows changes to `tomewise.json` without a restart; reload the page to see them.

## Trust

**A theme's JavaScript runs on every page, lessons included, with the same access as the widgets that record your practice.** Install only themes you trust, and read a theme's script before you add it to your learning home. Community themes are reviewed in their pull request.

## The theme folder

```
themes/moss/
  theme.json    required: name, author, version; optional description, script
  tokens.css    required: every token below, for light and dark
  theme.css     optional: any other rules
  moss.js       optional: the script named in theme.json
  assets/       optional: images and fonts, served at /themes/moss/assets/…
```

`theme.json` (JSON Schema: `schemas/v1/theme.json`):

```json
{ "name": "Moss", "author": "You", "version": "0.1.0", "script": "moss.js" }
```

`script` is a path inside the folder. The app loads it as a module on every page.

Built-in themes live in `app/themes/` in this repo and `themes/` in the installed tool.

## Light and dark

A theme follows the system's light or dark setting, and `data-mode="light"` or `data-mode="dark"` on `<html>` overrides it. `tokens.css` sets the light values on `:root` and repeats the dark ones for both cases:

```css
:root { color-scheme: light; --t-bg: #fffff8; /* … */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-mode="light"]) { color-scheme: dark; --t-bg: #161614; /* … */ }
}
:root[data-mode="dark"] { color-scheme: dark; --t-bg: #161614; /* … */ }
```

Fonts and radii can stay the same in dark mode; every colour token needs a dark value.

## Cascade layers

Every page the app serves declares one layer order:

```css
@layer tome.reset, tome.base, tome.widgets, theme;
```

The tool's reset and base styles (`/widgets/v1/base.css`) and the widgets' styles sit in the first three. The app imports `tokens.css` and `theme.css` into `theme`, so a theme rule beats any built-in rule whatever its specificity, without `!important`. Don't wrap your files in `@layer` yourself.

A lesson's own `<style>` is unlayered, so it beats the theme. Lessons should use only tokens (below), so they still follow the learner's theme.

## Tokens

Every theme defines these in `tokens.css`. Base styles, widgets and lessons read only these.

| Token             | Kind   | Used for                                        |
| ----------------- | ------ | ----------------------------------------------- |
| `--t-bg`          | color  | page background; buttons and inputs             |
| `--t-surface`     | color  | widget and card background                      |
| `--t-ink`         | color  | text                                            |
| `--t-muted`       | color  | secondary text: hints, kickers, skip            |
| `--t-rule`        | color  | borders and dividers                            |
| `--t-accent`      | color  | primary buttons, links, focus rings, progress   |
| `--t-accent-ink`  | color  | text on `--t-accent`                            |
| `--t-good`        | color  | correct: text and borders                       |
| `--t-good-bg`     | color  | correct: background                             |
| `--t-bad`         | color  | wrong, errors and notices: text and borders     |
| `--t-bad-bg`      | color  | wrong, errors and notices: background           |
| `--t-heat-0`      | color  | heatmap: a day with no practice                 |
| `--t-heat-1`      | color  | heatmap: least practice                         |
| `--t-heat-2`      | color  | heatmap: some practice                          |
| `--t-heat-3`      | color  | heatmap: more practice                          |
| `--t-heat-4`      | color  | heatmap: most practice                          |
| `--t-display`     | font   | display font: headings, prompts, fronts, scores |
| `--t-ui`          | font   | interface and body font                         |
| `--t-mono`        | font   | monospace: `<kbd>`, code, clocks                |
| `--t-radius`      | length | corner radius                                   |
| `--t-cell-radius` | length | heatmap cell corner radius                      |

A theme may add its own tokens, such as Meadow's `--t-leaf`, `--t-petal` and `--t-sun`. Nothing outside the theme relies on them.

## Classes

Themes reach markup through tag names, `.tome-*` classes and `data-*` states.

- A widget's first child is a block whose class is the tag name (`<tome-choice>` → `.tome-choice`). It carries `data-state`.
- While loading, the block holds only `<p class="tome-hint">Loading…</p>`.
- `.tome-notice` (`role="alert"`) inside the block reports a problem with the widget itself, such as an unknown item. A failed save appends `.tome-notice[data-state="unsaved"]` as the element's last child, outside the block.
- Shortcut keys show as `<kbd>` inside their button.

### Widget classes

[docs/widgets.md](./widgets.md) shows each widget's markup and states. These are the full lists:

| Widget | Classes |
| ------ | ------- |
| `<tome-audio>` | `tome-answer` `tome-answers` `tome-audio` `tome-countdown` `tome-feedback` `tome-hint` `tome-input` `tome-notice` `tome-play` `tome-prompt` `tome-respond` `tome-retry` `tome-say` `tome-stage` `tome-submit` `tome-verdict` |
| `<tome-choice>` | `tome-answer` `tome-answers` `tome-choice` `tome-feedback` `tome-hint` `tome-notice` `tome-prompt` `tome-retry` `tome-skip` `tome-stage` `tome-verdict` |
| `<tome-done>` | `tome-done` `tome-done-button` `tome-exam-score` `tome-notice` `tome-score` `tome-score-sub` `tome-verdict` |
| `<tome-drill>` | `tome-actions` `tome-again` `tome-clock` `tome-close` `tome-count` `tome-drill` `tome-drill-bar` `tome-drill-item` `tome-drill-name` `tome-drill-next` `tome-drill-title` `tome-empty` `tome-empty-title` `tome-hint` `tome-kicker` `tome-next` `tome-notice` `tome-progress` `tome-saved` `tome-score` `tome-score-sub` `tome-stats` `tome-summary` `tome-summary-head` |
| `<tome-exam-question>` | `tome-exam-question` `tome-notice` `tome-question` |
| `<tome-explain>` | `tome-actions` `tome-explain` `tome-explain-text` `tome-hint` `tome-notice` `tome-prompt` `tome-save` `tome-verdict` |
| `<tome-flashcard>` | `tome-back` `tome-flashcard` `tome-front` `tome-grade` `tome-grades` `tome-hint` `tome-notice` `tome-reveal` `tome-stage` `tome-verdict` |
| `<tome-routine>` | `tome-grade` `tome-grades` `tome-hint` `tome-next` `tome-notice` `tome-progress` `tome-routine` `tome-routine-name` `tome-stage` `tome-start` `tome-step` `tome-verdict` |
| `<tome-timer>` | `tome-clock` `tome-notice` `tome-timer` `tome-timer-controls` `tome-timer-reset` `tome-timer-toggle` `tome-verdict` |
| `<tome-typed>` | `tome-entry` `tome-feedback` `tome-hint` `tome-input` `tome-notice` `tome-prompt` `tome-retry` `tome-skip` `tome-stage` `tome-submit` `tome-typed` `tome-verdict` |

### Dashboard classes

The dashboard pages use these classes, taken from `docs/mockups/`. `/styleguide` shows each page as it lands; home, the subject home's tabs, the runner, its summary, the break between subjects, the Start list, settings, the glossary and every kind of "ask your agent" prompt with the agent's feedback are there now. `.tome-app` carries `data-state` (`loading`, `ready` or `error`), `.tome-runner` carries `data-state` (`loading`, `running`, `break`, `ask`, `empty`, `done` or `error`) and hosts `<tome-drill>`, and heatmap cells carry `data-date`, `data-level` (1 to 4; none for a day without practice), `data-today`, `data-future`, and `data-old` on weeks only wide screens show. On the settings page each `.tome-settings` section carries `data-setting` (`theme`, `start` or `subjects`), each `.tome-order-row` carries `data-subject` and, while dragged, `data-dragging`, and each `.tome-order-move` carries `data-move` (`up` or `down`). In the Start list the first `.tome-pick` carries `data-all` and the others `data-subject`. On the subject home each `.tome-tab` carries `aria-selected` and each `.tome-view` carries `data-view` (`overview`, `curriculum`, `drills`, `reference` or `stats`); `.tome-status` carries `data-status` (the milestone's status); with exams off, a milestone whose lessons are all completed and that isn't `done` or `skipped` shows `.tome-milestone-done`, its Mark done button; `.tome-next-lesson` (the overview's link to the first lesson not yet completed, or to the last one when all are) carries `data-lesson` and, when that lesson is completed, `data-done`; a lesson's `<li>` carries `data-done` once completed and `data-later` when it is in an `upcoming` milestone; on the Reference tab a sheet's `<li>` carries `data-sheet` and `data-later` when its milestone is `upcoming`; a drill's `<li>` carries `data-locked` while none of its items is unlocked; `.tome-goal-week` days carry `data-met` or `data-part` on their bar and `data-today`. On the glossary each lesson's `.tome-section` carries `data-lesson` (none for items no lesson unlocks), each `.tome-term` carries `data-item`, `.tome-term-when` carries `data-due` when the item is due today or overdue, and `.tome-hear` carries `data-playing` while its sound plays. On home the header holds `.tome-settings-link`, a link to the settings page, and `.tome-sync` carries `data-sync`: `ok`, `stopped` or `off`. When a newer release is out, home shows `.tome-update` under the header, carrying `data-install` (`npm` or `docker`), with the command to run in `.tome-update-command`. Each `.tome-ask` (an "ask your agent" prompt) carries `data-prompt`: `milestone-done`, `exam-unwritten`, `exam-ready` or `ungraded-explanations`.

The subject home's Stats tab draws each chart spec as a `.tome-chart` figure carrying `data-chart` (the spec's id), `data-kind` (`line` or `bar`) and `data-empty` when the chart has no data in its days. Inside the chart's SVG, `.tome-chart-grid` lines mark the top, middle and bottom of the scale; a line chart draws `.tome-chart-area`, `.tome-chart-line` and a `.tome-chart-dot` for each day with data, and a bar chart draws a `.tome-chart-bar` for each day, with `data-today` on today's. Dots and bars carry `data-date` and `data-value`. Style the SVG marks with `fill` and `stroke`; the plot stretches to its box, so strokes keep their width but corners set with `rx` stretch too.

`tome-actions` `tome-activity` `tome-again` `tome-app` `tome-ask` `tome-ask-go` `tome-ask-say` `tome-back` `tome-break` `tome-break-continue` `tome-break-done` `tome-break-next` `tome-break-skip` `tome-cell` `tome-chart` `tome-chart-area` `tome-chart-bar` `tome-chart-dot` `tome-chart-grid` `tome-chart-line` `tome-chart-plot` `tome-chart-x` `tome-chart-y` `tome-charts` `tome-check` `tome-copy` `tome-curriculum` `tome-drill-go` `tome-drill-name` `tome-drill-sub` `tome-drills` `tome-due` `tome-due-how` `tome-due-quiz` `tome-due-what` `tome-exam` `tome-explanation` `tome-explanation-feedback` `tome-explanation-from` `tome-explanation-text` `tome-explanations` `tome-field` `tome-field-name` `tome-fields` `tome-glossary` `tome-goal` `tome-goal-bar` `tome-goal-num` `tome-goal-week` `tome-header` `tome-hear` `tome-heat-days` `tome-heat-legend` `tome-heatmap` `tome-heatmap-wrap` `tome-hint` `tome-home-link` `tome-kicker` `tome-lede` `tome-lessons` `tome-look-again` `tome-look-item` `tome-look-why` `tome-mark` `tome-mark-letter` `tome-meta` `tome-meta-narrow` `tome-meta-wide` `tome-milestone` `tome-milestone-done` `tome-milestone-head` `tome-milestone-plain` `tome-next-lesson` `tome-notice` `tome-num` `tome-option` `tome-option-name` `tome-option-text` `tome-options` `tome-order` `tome-order-handle` `tome-order-move` `tome-order-name` `tome-order-row` `tome-overview` `tome-pick` `tome-pick-how` `tome-pick-name` `tome-picks` `tome-prompts` `tome-quiz-answer` `tome-quiz-answers` `tome-quiz-given` `tome-quiz-mark` `tome-quiz-me` `tome-quiz-prompt` `tome-reference` `tome-row` `tome-runner` `tome-runner-bar` `tome-runner-summary` `tome-score` `tome-score-sub` `tome-section` `tome-section-head` `tome-settings` `tome-settings-actions` `tome-settings-cancel` `tome-settings-link` `tome-settings-save` `tome-side` `tome-stage` `tome-start` `tome-stats` `tome-status` `tome-streak` `tome-streak-num` `tome-streak-text` `tome-subject` `tome-subject-ask` `tome-subject-name` `tome-subject-settings` `tome-subjects` `tome-summary-head` `tome-sync` `tome-sync-now` `tome-tab` `tome-tabs` `tome-term` `tome-term-when` `tome-term-word` `tome-terms` `tome-title` `tome-totals` `tome-unit` `tome-update` `tome-update-command` `tome-view`

## Seeing a theme

Open `/styleguide` in the app. It shows a sample lesson and every widget in each of its states, using a demo subject built into the tool. Its widgets talk to a stand-in API inside the page, so nothing you do there reaches your learning home.

- `/styleguide?theme=moss` shows another theme without changing `tomewise.json`.
- `/styleguide?mode=dark` (or `light`) overrides the system setting.

Once every demo has reached its state, the page sets `data-styleguide="ready"` on `<html>` (or `"failed"`, with the reasons in `data-styleguide-errors`). Dashboard pages join the styleguide as they land.

## Checking a theme

```
tome theme check meadow [--out <dir>]
```

The check serves your learning home (or, outside one, the built-in demo home), loads `/styleguide` in the theme at 375, 768 and 1280 px wide, in light and dark, with reduced motion, and reports:

- required tokens the theme doesn't define, in each mode;
- colour tokens that `data-mode="light"` or `data-mode="dark"` doesn't switch to the same value the system setting gives;
- text below WCAG AA contrast against the colour behind it: 4.5:1, or 3:1 for large text (24px, or 18.66px bold). Disabled and inert controls, and the inactive parts of a widget in its error state, are exempt, as WCAG allows, but an answer that shows a result (`data-state="correct"` or `"wrong"`) is checked even when disabled. Text over a gradient or image is measured against the nearest background colour only;
- any element that sticks out past the edge of the window, which would make the page scroll sideways.

It writes a full-page screenshot for each width and mode to `--out` (default: a new temporary folder), prints the folder, and exits with 1 if it found any problem.

CI runs the check on every theme folder under `app/themes/` that a pull request changes, and uploads the screenshots as the `theme-check-screenshots` artifact.

The check drives a browser with Playwright. In a clone of this repo it is already installed (`pnpm tome theme check meadow`). With the installed tool, add Playwright alongside it:

```
npx playwright install chromium
npx -p tomewise -p playwright tome theme check meadow
```

## For agents writing lessons

Style lessons with `var(--t-*)` tokens and the classes above, never literal colours or fonts, so a lesson follows whatever theme the learner picks.
