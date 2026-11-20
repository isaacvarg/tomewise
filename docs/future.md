# Future ideas (not v1)

Ideas we chose to keep but not build yet. Don't lose these.

- **Full Feynman grading in the app.** Questions in quizzes, exams, or after a run of lessons ask the learner to explain things in plain terms. An LLM in the app judges the explanation right away and steers the learner when their thinking is wrong or slightly off. It needs auth plus an AI provider in the app. v1 has the lightweight version (saved ungraded, graded by the agent later), and the data format is designed so this drops in.
- **App-triggered agents.** A "Generate next lesson / prepare my exam" button that runs a headless agent (for example `claude -p`) with a configurable command. Waits on auth.
- **Ingest into the PKM.** Voice notes, pictures, videos and links (Raindrop-like) feeding a vault inbox. A separate product that shares the vault; possibly its own repo.
- **MCP server** wrapping the same core as the CLI, for agents without a shell.
- **Hosted storage backend** behind the storage module, so the app could run on a cloud host.
- **Nix flake** alongside the OCI image and `npx`.
- **SQLite read index** rebuilt from the JSONL files, if queries ever get slow.
