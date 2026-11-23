# Tomewise

A self-hosted learning system grown out of Matt Pocock's `teach` skill. An AI agent writes the course; an always-on app runs it and remembers how you did, so the agent never has to be told.

## Places

**Tool**:
The installable software: the app, the CLI, the widgets and the skill. It holds no one's learning.
_Avoid_: the repo (ambiguous), the platform

**Learning home**:
A folder owned by one learner that holds all their subjects and history, usually its own git repository. It can sit anywhere, including inside a PKM vault.
_Avoid_: workspace, vault, data repo

**Vault mode**:
A learning home placed inside an Obsidian (or compatible) vault, with extra notes written so the vault can show the learning.
_Avoid_: Obsidian integration, PKM mode

**Session note**:
A Markdown note per session that vault mode generates from history: a frontmatter summary and a short body. Regenerated, never edited; history stays the source of truth.
_Avoid_: session log, journal entry

## Learning content

**Subject**:
One organised branch of knowledge or curriculum the learner is following, such as Spanish, the 3x3 Rubik's cube, yoga or Morse code. One mission per subject.
_Avoid_: topic, course, category, workspace

**Mission**:
The real-world reason the learner wants a subject. Every teaching decision traces back to it. (From `teach`.)
_Avoid_: goal (that is a different term here), objective

**Lesson**:
A single self-contained page that teaches one tightly scoped thing tied to the mission. Taught once; can be revisited.
_Avoid_: module, chapter, unit

**Item**:
The smallest thing that is reviewed and scheduled on its own, such as the letter K in Morse or the word "hola". Each item has its own review schedule, except routines, whose rhythm comes from a goal instead. An item whose meaning changes is retired and replaced by a new item, never deleted, because history still points at it.
_Avoid_: card, question, fact

**Item type**:
The shape of an item and how it is presented: flashcard, multiple choice, typed answer, timed/audio, routine, or a custom type a subject defines.

**Drill**:
A reusable practice session that draws a set of items in a given format, such as 30 Morse sounds where you pick the character. Drills are unscored practice, but every attempt in one still updates that item's review schedule.
_Avoid_: exercise, practice set, review session

**Review**:
Practising items that the schedule says are due, done in the app with no agent involved. A review is run as a drill.
_Avoid_: revision, study session

**Quiz**:
A short, scored check that mixes items from several lessons. Written by the agent, which chooses what to test from history; if a quiz comes due and none is written, the app builds one from each item's record.
_Avoid_: test, check

**Exam**:
A longer, cumulative assessment made of exam questions, to test transfer. Often tied to a milestone. Written by the agent ahead of time.
_Avoid_: test, final

**Exam question**:
A question written for one exam, never seen before and never scheduled for review. It names the items it tests, so a miss can bring those items forward. The one place "question" is the right word.
_Avoid_: prompt, item

**Explanation**:
The learner's own plain-language account of a concept (the Feynman method), saved ungraded and later graded with feedback by the agent.
_Avoid_: summary, essay

**Reference sheet**:
A compressed, printable summary for quick lookup, such as a cheat sheet or glossary. (From `teach`.)
_Avoid_: notes, docs

**Unlock**:
When a completed lesson makes its items, drills and reference sheets available. Lessons themselves are never locked.

**Curriculum**:
An optional, undated, ordered path of units and milestones for a subject. A compass, not a track: the agent may propose changes, and the learner confirms them.
_Avoid_: syllabus, roadmap, plan

**Milestone**:
A point on the curriculum with a status (done, current, upcoming, skipped, changed), its lessons and optionally an exam.
_Avoid_: checkpoint, level

**Learning record**:
A note of something non-obvious the learner has demonstrably learned, or a change of mission or curriculum and why. (From `teach`.)
_Avoid_: journal entry, log

## History and progress

**Event**:
One recorded fact about learning activity, such as an attempt, a lesson completed or a session ended. Events are only ever added, never edited.
_Avoid_: log line, record (that is a learning record)

**Envelope**:
The part of an event every subject shares: its own id, when, which subject, what kind, what it refers to (an item, a lesson, a drill, or another event), which session, how long, the outcome.

**Payload**:
The subject-specific part of an event, such as dit/dah timings for Morse or hold time for yoga. Its shape is described by the subject's payload schema, which the agent writes.
_Avoid_: metadata, extra

**Attempt**:
One answer to one item, or one try at one step. It has an outcome and a grade.

**Outcome**:
Whether an attempt was correct, wrong or skipped. Used for scores and stats.

**Grade**:
How well an attempt went on a 1–4 scale (again, hard, good, easy), which the review schedule uses. Self-rated items give it directly; otherwise a wrong answer is 1 and a correct one is 3.
_Avoid_: rating, score (a score belongs to a quiz or exam)

**Session**:
One continuous sitting of a lesson, drill, quiz or exam. Attempts belong to a session. A session belongs to the day it started.
_Avoid_: sitting, run

**Activity day**:
A day, in the learner's own timezone, with at least one session of a minimum length in any subject. Activity days feed the heatmap and the streak.

**Streak**:
The number of consecutive activity days, allowing a configured number of rest days per week.

**Rest day**:
A day without activity that does not break the streak, up to a weekly allowance. Weeks run Monday to Sunday by default.
_Avoid_: freeze, skip day

**Goal**:
An optional per-subject daily or weekly target (for example, 10 minutes of Morse copy a day), proposed by the agent and approved by the learner.
_Avoid_: mission (different term), target

## Look

**Theme**:
A swappable look for the app, its widgets and every lesson, chosen by the learner. A theme may change anything about appearance, layout included; lessons take their colours, fonts and decoration from it.
_Avoid_: skin, style, template

## People

**Learner**:
The single person a learning home belongs to.
_Avoid_: user (fine in code, not in teaching docs), student

**Agent**:
The AI coding agent (Claude Code, Codex, ...) running the skill. It writes content and reads history; it never runs inside the app in v1.
_Avoid_: tutor, teacher, bot
