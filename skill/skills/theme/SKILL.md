---
name: theme
description: Build or change a Tomewise theme, the learner's own look for the app, its widgets and every lesson. Use when the learner asks for new colours, fonts, a mood or a dark mode.
argument-hint: "What should it look like?"
---

A **theme** is a folder in the learning home's `themes/` that sets the look of every page the app serves. The theme contract is [docs/themes.md](https://github.com/isaacvarg/tomewise/blob/main/docs/themes.md): the folder layout, the light and dark pattern, the cascade layer, every required token and every class a theme can style. Read it before you write a line; it is the source of truth wherever this skill is shorter.

Run every `tome` command from the learning home. In a clone of the Tomewise repo it is `pnpm tome`; with the installed tool, `npx -p tomewise -p playwright tome` (run `npx playwright install chromium` once first).

## 1. Pin down the look

Ask the learner for a mood and a palette in their words ("mossy and quiet", "my club's orange and navy"), and any font they love. Pick a short lowercase folder name with them, such as `moss`. If they are changing an existing theme, read its folder first and change only what they asked for.

Done when you can name the accent colour, the background and the display font for both light and dark.

## 2. Write the folder

Start from [starter/](./starter/), a complete theme that already passes the check, and copy it to `themes/<name>/`. Then:

- `theme.json`: set `name`, `author` (the learner) and `version`, plus a one-line `description`.
- `tokens.css`: change the values, keeping all three blocks. Light values sit on `:root`; the dark values appear twice, identical, under `prefers-color-scheme: dark` and under `:root[data-mode="dark"]`.
- `theme.css` (add it if needed): only the rules tokens can't express (borders, type styles, layout), targeting the `.tome-*` classes and `data-*` states from the contract.
- A script only when the learner asks for motion or interaction. Theme JavaScript runs on every page with the access of the widgets that record practice, so tell the learner that and keep it small enough to read.

## 3. Hold the checklist

Every item, in light and in dark:

- **Tokens**: every required token from the contract is defined, and every colour token has a dark value.
- **Contrast**: WCAG AA, 4.5:1 for text (3:1 at 24px, or 18.66px bold). Pair each text token with every background it sits on: `--t-ink` on `--t-bg` and `--t-surface`; `--t-muted` on those and on `--t-good-bg` and `--t-bad-bg` (shortcut keys in a marked answer); `--t-accent` on `--t-bg` (links); `--t-accent-ink` on `--t-accent`; `--t-good` on `--t-good-bg`; `--t-bad` on `--t-bad-bg`. `--t-muted` is the usual failure.
- **Phone width**: at 375px wide nothing sticks out past the window. Fixed widths, long unbroken words and wide `min-width` are the usual causes.
- **Every page and widget**: the theme reaches the dashboard pages, every widget in every state and the lessons. `/styleguide?theme=<name>` shows them all; add `&mode=dark` for dark.

## 4. Run the check

```
tome theme check <name>
```

Each `✗` line names a problem with its width, mode and element. Fix the token or rule behind it and run the check again.

Done when the check exits 0, prints `<name> passes`, and you have looked at the 375px screenshots in both modes (the folder is printed as `Screenshots:`). Then tell the learner to pick the theme on the app's settings page, which previews it before saving.
