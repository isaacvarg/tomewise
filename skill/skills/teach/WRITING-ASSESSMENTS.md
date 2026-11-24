# Writing quizzes and exams

You write quizzes and exams ahead of time; the app serves each one when it comes due. [ASSESSMENTS-FORMAT.md](./ASSESSMENTS-FORMAT.md) says how a page is built. This page says when to write one and what goes in it.

## Read the settings first

The subject's **assessment settings** decide what you write. Each setting is the subject's `settings.assessments` value in `subject.json`, else `assessments` in `tomewise.json`, else the default:

| Setting | Default | What it decides |
| --- | --- | --- |
| `enabled` | `true` | `false`: no quizzes and no exams |
| `quizFrequency` | `{ "every": 5 }` | Which lessons get a quiz, below |
| `exams` | `true` | `false`: no exams; the learner marks milestones done by hand |
| `passMark` | `70` | The quiz pass mark, and the exam's unless the milestone sets its own `passMark` |
| `quizLength` | `10` | Questions in an app-built quiz; a fair size for yours |
| `timed` | `false` | `{ "minutes": N }`: every question fits in N minutes |

The learner picks these in the app (see [SUBJECT-FORMAT.md](./SUBJECT-FORMAT.md)). When a setting turns quizzes or exams off, write none. If the learner asks for one anyway, name the setting that turned it off and tell them they can change it in the app.

## A quiz with its lesson

Write the quiz in the same session as the lesson after which it comes due, so it is ready the moment its slot opens:

| `quizFrequency` | Write a quiz with |
| --- | --- |
| `{ "every": N }` | Lessons N, 2N, 3N and so on: a slot opens each time the learner completes N more lessons |
| `"weekly"` | The first lesson you write each week |
| `"onDemand"` | No lesson; write one only when the learner asks |

A written quiz that is still untaken fills the next slot first, and a newer one waits behind it.

1. Name the lesson you are writing in the quiz's `tome-after` (`lesson:0005-a`), and give the quiz an id that says what it covers (`quizzes/k-to-a.html`).
2. Draw the questions from the items unlocked since the previous quiz, the new lesson's included, and weight them toward items `tome due` lists. Each question is a `<tome-exam-question>` whose `tests` names its items by ref, holding one `<tome-choice>` or `<tome-typed>` (see [WIDGETS.md](./WIDGETS.md)).
3. Size it to the pass mark. A pass needs `passMark` percent of the questions right, unanswered ones counting wrong, so choose a count where the misses a pass allows are ones you would forgive: at 70, ten questions allow three misses and three questions allow none.
4. Ship it with the lesson: validate and commit both together, as `feat(<subject>): add lesson N (<title>) and its quiz`.

Done when the quiz's `tome-after` names the lesson you just wrote, every question tests an item that lesson or an earlier one unlocks, and `tome validate` passes.

## An exam for a ready milestone

A milestone is **ready** when the learner has completed every lesson in its `lessons` and its status is not yet `done` or `skipped`. If the milestone has an `exam` id and exams are on, the app then offers the learner the request "Prepare the exam for “<milestone title>”". Run that request as a session of its own: step 1 of the teaching session, then:

1. Find the milestone by its title in `curriculum.json`. Its `exam` id names the page: `exams/<exam>.html`.
2. Write **transfer** questions: new ones that combine the milestone's items in ways no lesson or quiz asked. Every item the milestone's lessons unlock appears in at least one question's `tests`.
3. Size it to the milestone's `passMark`, else the subject's, as for a quiz.
4. Run `tome validate`, commit as `feat(<subject>): add exam for <milestone id>`, push, and tell the learner the exam is ready at `/s/<subject>/exams/<exam>.html` in the app.

Done when every item of the milestone is tested, `tome validate` passes and `git push` succeeds.

When you add a milestone to `curriculum.json` and exams are on, give it an `exam` id; the milestone's own id serves. A milestone without one gets no exam, and the app asks the learner to mark it done instead.
