# Tomewise

A self-hosted learning system grown out of Matt Pocock's `teach` skill. An AI agent writes the course; an always-on app runs it, remembers every practice session, schedules your reviews and shows your streak.

Status: **designed, not built.** Start here:

- [CONTEXT.md](./CONTEXT.md): the glossary. Use these terms everywhere.
- [docs/design.md](./docs/design.md): the v1 design overview.
- [docs/adr/](./docs/adr/): why the big decisions went the way they did.
- [docs/future.md](./docs/future.md): ideas parked for later.
- [docs/names.md](./docs/names.md): the name and how each part uses it.
- [docs/widgets.md](./docs/widgets.md): `tome.js`, the widgets, their markup contract and the browser tests.
- [docs/deployment.md](./docs/deployment.md): running the app with npx or a container. It has no auth: keep it off the public internet.
- [skill/](./skill/): the `tomewise` Claude Code plugin. Its `teach` skill ([skill/skills/teach/](./skill/skills/teach/)) is forked from Matt Pocock's `teach` (MIT). The first commit is the untouched upstream copy.
