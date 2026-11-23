# Skill scenario tests replay a scripted session, not a live agent

The `teach` skill is a prompt, so its tests are scenarios: an agent session against a fixture learning home, checked by the files it wrote and the commands it ran. We test by replaying a **scripted session**: a test function that does what the skill tells the agent to do, step by step, through a harness (`cli/test/scenario.ts`) that runs real `git` and the real `tome` CLI against a copy of the Morse example with a local remote, and logs every command and file write. Assertions read that log and the files left behind. A second check pins the script to the skill: the commands the script runs appear in `SKILL.md` in the same order.

A live agent run would test the one thing replay can't: that a model reading the skill actually follows it. But it needs an API key and network in CI, costs money on every run, takes minutes, and passes or fails by chance, so a red run says little about the change that caused it. The scripted session is fast and deterministic, and still catches the failures we see most: a skill step whose output `tome validate` rejects, a step in the wrong order, a lesson the format docs don't support.

## Considered options

- Live agent in CI (Claude Code headless against the fixture): real coverage of model behaviour, but flaky, slow and paid; rejected as the default.
- Snapshot of a recorded live transcript: deterministic, but goes stale whenever the skill changes and has to be re-recorded by hand.

## Consequences

- A scenario proves the skill's procedure works with the tool, not that a model will follow it. Keeping the script and `SKILL.md` in step is the test's job, through the order check.
- The action log is the seam. A live run can be added later by translating an agent transcript (such as Claude Code's `stream-json` output) into the same log and reusing the assertions.
- Later `teach` scenarios (quizzes, exams, grading, import) write a new script against the same harness.
