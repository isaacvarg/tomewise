# Fork `teach` into our own skill instead of adding on to it

The skill starts as a fork of Matt Pocock's `teach` (MIT, credited) rather than an add-on skill running beside it. The changes reach into how lessons are written (use widgets, emit events, write items, drills, quizzes and `subject.json`, read history before planning), and an add-on cannot reliably override another skill's instructions.

It ships in the open Agent Skills format, both as a Claude Code plugin and through skills.sh, the same way Matt's skills are distributed.

## Consequences

- We own keeping up with useful upstream changes to `teach`; there's no automatic sync.
- `tome import <dir>` converts existing `teach` workspaces into subjects, so current `teach` users can switch.
