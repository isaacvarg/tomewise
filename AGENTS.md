# Tomewise

## Conventions

### Commits

- Use Conventional Commits: `type(scope): subject`, e.g. `docs: add glossary`, `chore(skill): import upstream teach skill`.
- Keep messages terse. Cut grammar for concision: drop articles and filler, use fragments.
- Run the message through the `unslop:unslop` skill before committing. Where unslop asks for whole sentences, concision wins.
- No attribution lines: no `Co-Authored-By`, no "Generated with" footer, no session links.

### Code comments

Never add a code comment without approval. Before writing one, show the user the exact comment and where it goes, then wait for a yes.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `isaacvarg/tomewise`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
