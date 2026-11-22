# `tome due`

```
tome due [<subject>] [--date YYYY-MM-DD] [--json]
```

Lists the items due for review, from the scheduler's replay of each subject's events. Without a subject it covers every subject in the learning home. `--date` asks about another day; it defaults to today. Days are read in the learning home's `timezone`, and an item counts as due on a day if it falls due before that day ends.

Routine items, retired items and items still locked behind an uncompleted lesson are never listed. An item with no attempts yet is due from the moment its lesson was completed, or always if it has no `unlockedBy`.

## Human output

```
Due on 2026-11-20: 4 items

morse-code (3)
  letter-m  due 2026-11-10
  letter-r  due 2026-11-11
  letter-k  due 2026-11-13

semaphore (1)
  letter-a  new
```

Subjects with nothing due are left out. With nothing due anywhere it prints `Nothing due on 2026-11-20`.

## `--json`

```json
{
  "date": "2026-11-20",
  "timezone": "Europe/London",
  "items": [
    {
      "subject": "morse-code",
      "due": "2026-11-10T21:10:02.030Z",
      "item": { "id": "letter-m", "type": "timed-audio", "answer": "M", "unlockedBy": "0001-k-and-m", "tags": ["letter"], "retired": false }
    }
  ]
}
```

- `date`: the day asked about, `YYYY-MM-DD` in `timezone`.
- `timezone`: the learning home's timezone.
- `items`: every due item, grouped by subject in subject order, and within a subject by `due`, earliest first, with `null` before any date.
  - `subject`: the subject's folder name.
  - `due`: when the item fell due, as an ISO 8601 UTC instant, or `null` for an item with no `unlockedBy` and no attempts.
  - `item`: the item as stored, with defaults filled in (`tags`, `retired`, and so on).

## Exit codes

- `0`: printed the list, even an empty one.
- `1`: the learning home or a subject has problems; run `tome validate`.
- `2`: bad arguments, a `--date` that isn't a real day, an unknown subject, or no learning home found.
