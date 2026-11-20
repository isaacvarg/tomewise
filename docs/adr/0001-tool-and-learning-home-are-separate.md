# The tool and the learning home are separate

The software (app, CLI, widgets, skill) is installed once and pointed at a learning home: a separate folder, usually its own git repo, holding one learner's subjects and history. We rejected a single template repo that people fork, because pulling tool updates into a fork full of personal data means endless merges, and because the learning home has to be able to live anywhere, including inside a PKM vault.

## Consequences

- The learning home's file layout is a public contract. `tomewise.json` carries a `formatVersion`, and the tool ships migrations.
- Widgets are served by the tool, so their API is versioned; old lessons must keep working.
- Tools find the learning home by walking up from the current directory to `tomewise.json` (like git), then the global config written by `init`, then an env var.
