---
name: theme-check
description: Review loop around `tome theme check` with the learner. Use when the learner wants to review a Tomewise theme: see its screenshots and tune it until they approve it.
argument-hint: "Theme name (default: the one in tomewise.json)"
---

You and the learner review a theme together in **rounds**. Each round: run the check, show the screenshots, ask, edit. The loop ends on a **clean round**: a round where `tome theme check` exits 0 _and_ the learner, looking at that round's screenshots, says the theme is right. Either half alone starts another round.

## Before the first round

1. **Name the theme.** Use the name the learner gave. Otherwise read `theme` from `tomewise.json` at the learning home's root (`paper` when it is absent).
2. **Find the folder you will edit.**
   - In a learning home: `themes/<name>/`. When it isn't there, the theme is built in. Ask the learner before copying the tool's built-in folder (`themes/<name>/` in the tool, `app/themes/<name>/` in a clone of the tool's repo) into the learning home's `themes/<name>/`: the copy overrides the built-in theme and stops receiving the tool's updates to it.
   - In a clone of the tool's repo, outside a learning home: `app/themes/<name>/`.

## A round

1. **Run the check** from the learning home (or the repo root):

   ```
   tome theme check <name> --out <scratch>/round-<n>
   ```

   In a clone of the tool's repo, run `pnpm tome` instead of `tome`. Pick `<scratch>` outside the learning home, so screenshots stay out of its history. A fresh folder per round keeps earlier rounds for comparison.

   A round needs the check to reach the theme. When it stops before checking, fix the cause and rerun:
   - `No theme "<name>"`: the folder from [Before the first round](#before-the-first-round) is missing or misnamed.
   - No Playwright or Chromium: relay the command's own install instructions to the learner and rerun once they have installed it.

2. **Look at all six screenshots yourself.** The folder holds `<name>-<width>-<mode>.png` for widths 375, 768 and 1280 in `light` and `dark`. Note anything the check can't see: clashing colours, unreadable fonts, cramped spacing, a widget state that looks broken.

3. **Show the learner the screenshots.** Attach them when your client can display images; otherwise give the full path of each file. Alongside them, report in plain words:
   - each `✗` line the check printed, grouped by kind (see [Check problems](#check-problems)), and how you plan to fix it;
   - what you noticed in step 2.

4. **Ask for feedback.** One question: what should change, or is the theme right?

5. **Decide.**
   - Check exited 0 and the learner says it's right: this is the clean round. Go to [Finish](#finish).
   - Otherwise, **edit** the theme: fix every check problem, then make the learner's changes. When a request conflicts with a check rule (a colour pair that fails contrast), say so and offer the nearest value that passes. Then start the next round.

Every edit, however small, earns a new round: the learner approves only what they have seen, and the check passes only on the files as they are now.

## Editing

- Colours, fonts and radii are tokens in `tokens.css`. Light values sit on `:root`. Dark values sit twice, identically: in `:root:not([data-mode="light"])` inside `@media (prefers-color-scheme: dark)`, and in `:root[data-mode="dark"]`.
- Any other rule goes in `theme.css`. Target `.tome-*` classes, tag names and `data-*` states.
- To change the theme's whole character, or to build a new one, use the `theme` skill; it holds the theme contract.

## Check problems

| `✗` line says | Fix |
| --- | --- |
| `missing token --t-…` | Define that token in `tokens.css`, in the mode the line names. |
| `data-mode="dark" doesn't switch --t-…` | `:root[data-mode="dark"]` lacks the token or differs from the media-query block. Copy the media-query value. |
| `data-mode="light" doesn't switch --t-…` | The dark media-query block applies over `data-mode="light"`. Scope it to `:root:not([data-mode="light"])`. |
| `contrast X:1, needs Y:1 · <element> in <section>` | Darken or lighten the text or the background behind it until the pair passes. The element and section name where to look. |
| `overflow · <element> is Npx wide` | Make that element fit the width the line names: let it wrap, shrink, or scroll inside its own box. |

## Finish

Tell the learner the theme passes the check and matches what they approved, and name the folder you edited.
