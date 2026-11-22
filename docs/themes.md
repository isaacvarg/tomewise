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
| `<tome-done>` | `tome-done` `tome-done-button` `tome-notice` `tome-verdict` |
| `<tome-drill>` | `tome-actions` `tome-again` `tome-clock` `tome-count` `tome-drill` `tome-drill-bar` `tome-drill-item` `tome-drill-name` `tome-drill-next` `tome-drill-title` `tome-empty` `tome-empty-title` `tome-hint` `tome-kicker` `tome-next` `tome-notice` `tome-progress` `tome-saved` `tome-score` `tome-score-sub` `tome-stats` `tome-summary` `tome-summary-head` |
| `<tome-exam-question>` | `tome-exam-question` `tome-notice` `tome-question` |
| `<tome-explain>` | `tome-actions` `tome-explain` `tome-explain-text` `tome-hint` `tome-notice` `tome-prompt` `tome-save` `tome-verdict` |
| `<tome-flashcard>` | `tome-back` `tome-flashcard` `tome-front` `tome-grade` `tome-grades` `tome-hint` `tome-notice` `tome-reveal` `tome-stage` `tome-verdict` |
| `<tome-routine>` | `tome-grade` `tome-grades` `tome-hint` `tome-next` `tome-notice` `tome-progress` `tome-routine` `tome-routine-name` `tome-stage` `tome-start` `tome-step` `tome-verdict` |
| `<tome-timer>` | `tome-clock` `tome-notice` `tome-timer` `tome-timer-controls` `tome-timer-reset` `tome-timer-toggle` `tome-verdict` |
| `<tome-typed>` | `tome-entry` `tome-feedback` `tome-hint` `tome-input` `tome-notice` `tome-prompt` `tome-retry` `tome-skip` `tome-stage` `tome-submit` `tome-typed` `tome-verdict` |

### Dashboard classes

The dashboard pages use these classes, taken from `docs/mockups/`. They arrive with the dashboard; `/styleguide` shows them as each page lands.

`tome-activity` `tome-app` `tome-cell` `tome-due` `tome-header` `tome-heat-days` `tome-heat-legend` `tome-heatmap` `tome-heatmap-wrap` `tome-kicker` `tome-runner` `tome-runner-bar` `tome-section` `tome-section-head` `tome-stage` `tome-start` `tome-streak` `tome-subject` `tome-subject-name` `tome-subjects` `tome-title`

## For agents writing lessons

Style lessons with `var(--t-*)` tokens and the classes above, never literal colours or fonts, so a lesson follows whatever theme the learner picks.
