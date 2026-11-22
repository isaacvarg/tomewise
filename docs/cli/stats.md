# `tome stats`

```
tome stats [subject] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]
```

Summarises practice from the event envelope only (ADR 0003): sessions, time, attempts by outcome, accuracy, activity days and the streak. Without a subject it covers every subject.

- Dates are days in the learning home's `timezone`. Both ends are inclusive.
- `--to` defaults to today. Without `--from` the range starts at the first event.
- A session counts on the day it started. An attempt counts on the day of its own `ts`.
- Activity days and the streak follow `core`'s activity rules: sessions shorter than `minimumSessionSeconds` don't make a day active, and `streak.restDaysPerWeek` days may be missed per week. The streak is as of `--to`.
- Exit codes: `0` success, `1` the learning home has problems, `2` bad arguments, unknown subject or no learning home.

## `--json`

```json
{
  "subjects": ["morse-code"],
  "from": null,
  "to": "2026-11-21",
  "timezone": "Europe/London",
  "sessions": 4,
  "durationMs": 60440,
  "attempts": { "total": 23, "correct": 20, "wrong": 3, "skipped": 0 },
  "accuracy": 0.8695652173913043,
  "activityDays": 0,
  "streak": { "days": 0, "restDaysLeft": 0 }
}
```

| Field | Meaning |
|---|---|
| `subjects` | Subjects covered, sorted |
| `from` | First day of the range, or `null` for no lower bound |
| `to` | Last day of the range |
| `timezone` | Zone the days are in |
| `sessions` | `session.start` events in the range |
| `durationMs` | Total session time: each `session.end`'s `duration`, or the span to the session's last event if it never ended |
| `attempts` | Attempts in the range, in total and by outcome |
| `accuracy` | `correct / total` from 0 to 1; skipped attempts count against it. `null` with no attempts |
| `activityDays` | Active days in the range |
| `streak.days` | Current streak in days, as of `to` |
| `streak.restDaysLeft` | Rest days still allowed in `to`'s week |

New fields may be added; existing ones keep their name and meaning.
