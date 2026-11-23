# Subject setup and curriculum changes

Two branches: **setting up a new subject**, when the learner asks to learn something with no folder in `subjects/`, and **changing the curriculum** of an existing one.

## Setting up a new subject

Run these steps in order, from the learning home root. Each file's format doc says what goes in it; read it before writing the file.

### 1. Pull

```sh
git pull
```

If the pull fails, stop and show the learner the error.

Done when the pull succeeds and `subjects/<subject>/` still doesn't exist.

### 2. Name the subject

Agree with the learner on the display name (`"Touch typing"`) and the folder id (`touch-typing`): lowercase letters, digits and hyphens.

Done when the learner has agreed to both.

### 3. Mission

Interview the learner for why they want the subject, then write `MISSION.md` ([MISSION-FORMAT.md](./MISSION-FORMAT.md)). Push back until the *Why* names a concrete outcome.

Done when the learner agrees the mission says what they want.

### 4. Payload schema

Decide what each answer records beyond right or wrong, from what the mission needs to measure: words per minute for typing, the letter heard for Morse. Write it as payload schema version 1 in `subject.json` ([SUBJECT-FORMAT.md](./SUBJECT-FORMAT.md)). Give numeric fields a `unit`.

Done when every measure the mission's *Success looks like* names has a field.

### 5. Assessment settings

Ask the learner each of these, and offer the home's value (`assessments` in `tomewise.json`, else its schema default) as the default answer:

| Key | Ask |
| --- | --- |
| `enabled` | Quizzes and exams at all? |
| `quizFrequency` | A quiz every N lessons, weekly, or only when asked? |
| `quizLength` | How many questions in a quiz? |
| `exams` | An exam to finish each milestone? |
| `timed` | A time limit on quizzes and exams? |
| `scoreDisplay` | Show the score as a number, pass or fail, or not at all? |
| `passMark` | What percentage passes? |

Write every answer that differs from the home's value under `settings.assessments` in `subject.json`, exactly as the learner gave it; leave the rest out so they follow the home. With quizzes or exams on, keep every `attempt` field optional.

From here the learner owns these settings: they change them in the app.

Done when every key has an answer and `settings.assessments` holds each one that differs from the home.

### 6. Curriculum

Draft `curriculum.json` ([CURRICULUM-FORMAT.md](./CURRICULUM-FORMAT.md)) from the mission: units of milestones, each titled by what the learner can do once there. Mark the first milestone `current` and the rest `upcoming`. Leave out `lessons` and `exam` until those pages exist. Show the learner the path and adjust it until they agree.

Done when the learner has agreed to the path and `curriculum.json` holds it.

### 7. Validate, commit and push

```sh
tome validate
git add subjects/<subject>
git commit --message "feat(<subject>): start subject"
git push
```

Fix every problem `tome validate` reports and run it again before committing.

Done when `git push` succeeds. Then teach the first lesson, from step 2 of the teaching session.

## Changing the curriculum

The curriculum is a compass: you may propose a change to the path whenever the learner's history, records or mission argue for one, and the learner decides.

1. **Propose.** Tell the learner what would change (milestones added, dropped, reordered or retitled) and why, in a sentence or two.
2. **Wait for a yes.** Until the learner agrees, leave `curriculum.json` as it is. On a no, keep the path, and note the declined proposal in `NOTES.md` so you don't repeat it.
3. **Write both.** On a yes, edit `curriculum.json` and write a learning record ([LEARNING-RECORD-FORMAT.md](./LEARNING-RECORD-FORMAT.md)) saying what changed and why. A milestone with history keeps its id: mark it `skipped` or `changed` rather than deleting it.
4. **Validate, commit and push** the two together:

   ```sh
   tome validate
   git add subjects/<subject>
   git commit --message "chore(<subject>): update curriculum, <what changed>"
   git push
   ```

Done when the push carries `curriculum.json` and its learning record in one commit.
