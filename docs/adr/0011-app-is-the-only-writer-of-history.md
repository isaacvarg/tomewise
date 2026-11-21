# The app is the only writer of history; git carries content

The app runs on a server so the learner can practise from any device, while the agent usually runs on another machine (a laptop or desktop) with its own clone of the learning home. If both appended to the same `events/*.jsonl`, git would hit merge conflicts in the history. So `tome log` sends events to the app's `/api/events`, and the app is the only process that writes event files. Only when the app can't be reached does `tome log` write to a per-machine file (`events/YYYY-MM.<machine>.jsonl`), which never conflicts because no other machine touches it; the app reads all event files.

Content flows the other way, by git. The agent is the only writer of content, so it commits and pushes after writing; the app pulls, commits its events on the configured cadence, and pushes. The agent pulls before reading history.

The app is reached from other devices over a private network such as Tailscale, never the public internet (ADR 0004).

## Considered options

- Require one shared folder for app and agent: simplest, but rules out server-plus-laptop, which is the main way the tool is meant to be used.
- Per-machine event files always: works, but leaves history scattered when the app is reachable and could have kept it in one place.

## Consequences

- This replaces ADR 0002's "one writer per learner" reasoning: there is one writer of history (the app) and one writer of content (the agent).
- `tome log` needs the app's URL, stored in the global config at `init`.
- The app needs git credentials to push, which matters when it runs in a container.
