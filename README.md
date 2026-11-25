# Tomewise

[![npm](https://img.shields.io/npm/v/tomewise)](https://www.npmjs.com/package/tomewise)
[![ghcr.io](https://img.shields.io/github/v/tag/isaacvarg/tomewise?sort=semver&label=ghcr.io)](https://github.com/isaacvarg/tomewise/pkgs/container/tomewise)
[![license](https://img.shields.io/github/license/isaacvarg/tomewise)](./LICENSE)

A self-hosted learning system grown out of Matt Pocock's `teach` skill. An AI agent writes your course as plain files. An always-on app serves the lessons, records every answer, schedules your reviews and tracks your streak. At the next session the agent reads that history and plans the next lesson from it.

Everything lives in a **learning home**: a folder (usually its own git repo) that holds your subjects, lessons and history. Nothing is stored anywhere else.

## How it works

1. You ask your agent for a lesson with `/tomewise:teach`.
2. The agent runs `tome stats` and `tome due` to see your history, writes the lesson, its items and drills into the learning home, runs `tome validate`, then commits and pushes.
3. You open the app in a browser, on any device that can reach it, and work through the lesson. Every answer becomes an event in the subject's history.
4. The app pulls the agent's new content, commits your history and pushes it.
5. The next time you ask for a lesson, the agent starts from what you got right, what you missed and what's due for review.

## Packages

| What | Where | Gives you |
| --- | --- | --- |
| `tomewise` | [npm](https://www.npmjs.com/package/tomewise) | The `tome` command (also installed as `tomewise`) and the app it serves |
| `ghcr.io/isaacvarg/tomewise` | GitHub Container Registry | The app as a container image, for `linux/amd64` and `linux/arm64` |
| `tomewise` plugin | This repo's Claude Code marketplace | The `teach`, `theme` and `theme-check` skills |

## Getting started

Needs Node 24 or later.

1. Install the CLI:

   ```sh
   npm install -g tomewise
   ```

2. Create a learning home. `init` asks whether to use git, your default quiz and exam settings, and how to run the app (now, as a background service, or with Docker). Leave out the folder and it also asks where to put it and whether it goes in an Obsidian vault:

   ```sh
   tome init ~/learning
   ```

3. Install the plugin in Claude Code:

   ```sh
   claude plugin marketplace add isaacvarg/tomewise
   claude plugin install tomewise@tomewise
   ```

   Inside a session, the same steps are `/plugin marketplace add isaacvarg/tomewise` and `/plugin install tomewise@tomewise`. For other agents, install the skills from [skills.sh](https://skills.sh) with `npx skills add isaacvarg/tomewise`.

4. From the learning home, ask your agent for a first subject:

   ```text
   /tomewise:teach Set up a new subject in ~/learning: Morse code
   ```

5. Open the app at `http://127.0.0.1:4777` and take the lesson. After that, each `/tomewise:teach next lesson` builds on your history.

To try it without installing anything, `npx tomewise <command>` runs any command below.

## Updating

Nothing updates on its own. Once a day `tome` asks the npm registry for the latest release. When there's a newer one, the CLI prints a line after a command and the dashboard shows a notice on home, with the command to run: `npm install -g tomewise@latest`, or `docker pull` for the Docker image. Set `TOMEWISE_NO_UPDATE_CHECK=1` to turn the check off. It's also off in CI, under `npx`, and for `--json` output.

- **CLI.** Run `npm install -g tomewise@latest`. `npx tomewise` fetches the latest version by itself.
- **Background service.** The service runs the installed `tome`, so restart it after upgrading the CLI: `systemctl --user restart tomewise` on Linux, `launchctl kickstart -k gui/$(id -u)/tomewise` on macOS. If Node moved to a new path, run `tome service install` again instead.
- **Docker.** `init` pins the image to a minor version such as `:0.1`. For a patch release, `docker pull` that tag, then remove and recreate the container. For a minor release, switch to the new tag, or use `:latest`.
- **Plugin.** Third-party marketplaces don't auto-update by default. Refresh the marketplace, then update the plugin and restart Claude Code:

  ```sh
  claude plugin marketplace update tomewise
  claude plugin update tomewise@tomewise
  ```

  Inside a session, `/plugin` does the same. If you installed with `npx skills add`, run it again.

## Running the app

[docs/deployment.md](./docs/deployment.md) covers each way to run it:

- `tome serve` in the foreground;
- `tome service install` for a systemd or launchd service that starts when you log in;
- the container image, including a compose file for two learners and git credentials for syncing.

**The app has no login.** Anyone who can reach its port can read your learning home and write to your history. Keep it on localhost or a private network such as Tailscale, and never expose it to the public internet.

## Commands

| Command | Does |
| --- | --- |
| `tome init` | Create a learning home |
| `tome serve` | Run the app |
| `tome service install \| uninstall \| status` | Manage the app as a background service |
| `tome stats` | Sessions, time, accuracy and streaks |
| `tome due` | Items due for review |
| `tome query` | Aggregate a subject's payload fields |
| `tome log` | Record an event through the app |
| `tome validate` | Check the learning home's files |
| `tome import <dir>` | Bring in a `teach` workspace as a new subject |
| `tome theme check <name>` | Screenshot a theme and check contrast and overflow |
| `tome vault rebuild` | Regenerate Obsidian notes from history |

`tome --help` lists every flag. [docs/cli/](./docs/cli/) covers `due`, `stats` and `vault` in detail.

## Docs

- [CONTEXT.md](./CONTEXT.md): the glossary. Use these terms everywhere.
- [docs/design.md](./docs/design.md): the v1 design.
- [docs/adr/](./docs/adr/): why the big decisions went the way they did.
- [docs/widgets.md](./docs/widgets.md): `tome.js`, the widgets and their markup contract.
- [docs/themes.md](./docs/themes.md): how themes work.
- [docs/future.md](./docs/future.md): ideas parked for later.
- [docs/names.md](./docs/names.md): the name and how each part uses it.

## Development

The repo is a pnpm workspace: `core/` (schemas, events, stats, scheduler), `cli/`, `app/` (Hono server and React dashboard), `widgets/` and `skill/` (the plugin). [examples/morse/](./examples/morse/) is a learning home to try things against.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm typecheck
pnpm test
```

`pnpm tome <command>` runs the CLI from source. It runs from the repo root, so point it at a learning home with `TOMEWISE_HOME`. `serve` needs the widgets and dashboard built first:

```sh
pnpm build:widgets && pnpm build:app
TOMEWISE_HOME=~/learning pnpm tome serve
```

`pnpm build` writes the npm package to `build/tomewise/`. Pushing a `v*` tag publishes it and the container image; [docs/releasing.md](./docs/releasing.md) has the steps and the one-time npm setup.

## Credit

The `teach` skill in [skill/skills/teach/](./skill/skills/teach/) is forked from Matt Pocock's `teach` (MIT); its first commit is the untouched upstream copy. Tomewise is MIT licensed.
