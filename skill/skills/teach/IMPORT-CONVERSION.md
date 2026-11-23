# Converting an imported `teach` workspace

The learner ran `tome import` on a workspace from the original `teach` skill and asks you to convert it. The import copied the workspace into `subjects/<subject>/`, wrote a `subject.json` with only a name, recorded every lesson as completed, and printed a checklist. The old pages still run their own scripts from `assets/`, which keep progress in the browser's `localStorage`, so no answer reaches the learner's history and nothing is scheduled.

Converting means every **drill** in the old pages becomes a widget that records through the app. Run these steps in order.

### 1. Survey the workspace

From the learning home root, run `git pull`. Then read every page in `lessons/` and `reference/`, every script and stylesheet in `assets/`, `NOTES.md` and the `learning-records/`.

Done when you can list every drill: the script that runs it, each page that loads it, and the content each page feeds it (the cards, letters or steps in its markup).

### 2. Sort the drills

A drill is **generic** when an item type in [WIDGETS.md](./WIDGETS.md) does the same job: flip cards are `flashcard`, pick one answer is `multiple-choice`, type the answer is `typed-answer`, hear and name is `timed-audio`, a guided sequence of steps is `routine`. It becomes the built-in widget.

A drill is **subject-specific** when the learner does something no item type captures: order a character's strokes, tap a rhythm, move a piece on a board. It becomes a custom widget in `assets/`.

Done when every drill from step 1 has a target: a built-in tag or a custom element name.

### 3. Write the payload schema and items

- **Items.** Write one item per thing the learner recalls, in `items/NNNN-<name>.json` named after the imported lesson that teaches it, with `"unlockedBy"` set to that lesson. The import marked those lessons complete, so their items are reviewable at once. Read [ITEMS-FORMAT.md](./ITEMS-FORMAT.md).
- **Keep every lesson's file name.** The imported `lesson.completed` events refer to it.
- **Items for a custom widget** take the built-in type that still works when `<tome-drill drill="review">` shows the item on its own, such as a `flashcard` whose back describes the answer.
- **Payload schema.** Add `payloadSchemas` to `subject.json` with the `data` fields your custom widgets record, as version 1: the import's events carry empty `data`, so version 1 still holds them. Keep the `attempt` fields optional, because built-in widgets in the same subject record attempts without them. Read [SUBJECT-FORMAT.md](./SUBJECT-FORMAT.md).
- **Drills.** Write a `drills/<id>.json` that draws the converted items by tag. Read [DRILLS-FORMAT.md](./DRILLS-FORMAT.md).

Done when every item a converted page will show exists and is unlocked by that page's lesson.

### 4. Write the custom widgets

Port each subject-specific drill to a module in `assets/`, named after its element (`assets/kana-strokes.js` defines `<kana-strokes>`), following the custom widget contract in [WIDGETS.md](./WIDGETS.md). Keep the old interaction; where the old script saved to `localStorage`, the widget calls `tome.attempt` with the item's ref instead.

Done when each custom widget records an attempt whose `data` uses only fields from the payload schema.

### 5. Rewrite the pages

Rewrite each lesson and reference sheet in place, keeping its teaching text and links:

- Replace each drill's markup and `<script>` with its widget, one per item, and load custom widgets with `<script type="module">`.
- Run the lesson's drill with `<tome-drill>` and end every lesson with `<tome-done>` or a `final` widget.
- Style the page with the theme tokens and `.tome-*` classes listed in step 3 of [SKILL.md](./SKILL.md#3-write-the-lesson), in place of the old stylesheet and inline colours.

Then `git rm` every old script and stylesheet the pages no longer load.

Done when every `tome-*` tag is a widget, every colour is a `var(--t-*)` token, and no file in the subject mentions `localStorage`.

### 6. Validate, commit and push

```sh
tome validate
git add subjects/<subject>
git commit --message "feat(<subject>): convert imported workspace to widgets"
git push
```

Fix every problem `tome validate` reports and run it again before committing.

Done when `git push` succeeds. Tell the learner the converted lessons now record their answers and that review of the imported items starts today.
