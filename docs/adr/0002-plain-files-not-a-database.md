# History is plain files (JSON/JSONL), not SQLite

Learning history lives in append-only JSONL files per subject (`events/YYYY-MM.jsonl`), and content in JSON and Markdown. We chose this over SQLite so the learning home diffs cleanly in git, can be queried by any agent with `jq` or `grep` with no tooling, opens in Obsidian or any editor, and is safe on network mounts, where SQLite locking is unreliable. History has a single writer (the app; see ADR 0011), so a database's concurrency handling buys nothing.

## Consequences

- If queries get slow, a SQLite index may be added later as a disposable cache rebuilt from the files. The files stay the source of truth.
- Events are split by month so no single file grows without bound.
