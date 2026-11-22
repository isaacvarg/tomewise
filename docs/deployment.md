# Running the app

The app is one Node process. It serves your lessons and the dashboard from your learning home and writes your practice history into it. Run it with `npx` or as a container.

## The app has no auth

Anyone who can reach the app's port can read your learning home and write to your history. There is no login, no password and no token.

- Run it on localhost, or on a private network such as Tailscale.
- **Never** expose it to the public internet: no port forwarding on your router, no public VPS address, no reverse proxy that faces the internet.
- To reach it from your phone, put the phone and the server on the same tailnet and bind the app to the server's Tailscale address, not to every interface.

## With npx

Needs Node 24 or later.

```sh
cd ~/learning
npx tomewise serve
```

It prints `Listening on http://127.0.0.1:4777`. The learning home is found the usual way: a `tomewise.json` in the current folder or a folder above it, then `learningHome` in `~/.config/tomewise/config.json`, then `$TOMEWISE_HOME`.

| Setting | Flag     | Env var         | Default     |
| ------- | -------- | --------------- | ----------- |
| Host    | `--host` | `TOMEWISE_HOST` | `127.0.0.1` |
| Port    | `--port` | `TOMEWISE_PORT` | `4777`      |

Flags win over env vars. To serve your tailnet, pass the Tailscale address, e.g. `npx tomewise serve --host 100.101.102.103`.

The app refuses to start against a learning home it can't read or that fails `tome validate`, and says why.

## As a background service

To keep the app running whenever you're logged in, install it globally and then install the service:

```sh
npm install -g tomewise
cd ~/learning
tome service install
```

`install` takes the same `--host` and `--port` as `serve`, and records the learning home, the host and the port it finds when you run it. Run it again to change them.

- **Linux:** writes a systemd user unit to `~/.config/systemd/user/tomewise.service`, enables it and starts it. It starts when you log in. To start it at boot, run `loginctl enable-linger`.
- **macOS:** writes a launchd agent to `~/Library/LaunchAgents/tomewise.plist` and loads it. Logs go to `~/Library/Logs/tomewise.log`.
- **Windows:** installs nothing. It prints the steps to run `tome serve` at log on with Task Scheduler.

`tome service status` says whether it's installed and running (`--json` for scripts). `tome service uninstall` stops it and removes the file.

The service runs the `tome` you installed it with. Installing it from `npx` points it at npx's cache, which can be cleared, so install globally first.

## As a container

The image runs `tome serve` against the learning home mounted at `/learning-home`. Inside the container it listens on all interfaces (`0.0.0.0:4777`), so what reaches it is decided by how you publish the port.

Build it from a checkout of this repository:

```sh
docker build -t tomewise .
```

Run it, publishing the port on localhost only:

```sh
docker run -d --name tomewise \
  -p 127.0.0.1:4777:4777 \
  -v ~/learning:/learning-home \
  tomewise
```

Podman takes the same arguments.

- **Publish to one address.** `-p 4777:4777` publishes on every interface, and Docker's port rules bypass host firewalls such as ufw. Always name the address: `127.0.0.1` for this machine, or the server's Tailscale address for your tailnet.
- **File ownership.** The app runs as the image's `node` user (uid 1000) and writes events into the volume. If your learning home belongs to another user, run with `--user "$(id -u):$(id -g)"` and `-e HOME=/home/node`, so git still finds the files under [Git credentials](#git-credentials).
- **Timezone.** Days and streaks count in the learning home's `timezone` from `tomewise.json`. Set it there; without it the app uses the container's zone, which is UTC.

## Two learners, two instances

Each learner gets their own instance, their own learning home and their own port. Nothing is shared between them.

```yaml
# compose.yaml
services:
  alex:
    image: tomewise
    restart: unless-stopped
    volumes:
      - /srv/learning/alex:/learning-home
    ports:
      - "127.0.0.1:4777:4777"

  sam:
    image: tomewise
    restart: unless-stopped
    volumes:
      - /srv/learning/sam:/learning-home
    ports:
      - "127.0.0.1:4778:4777"
```

`docker compose up -d` starts both: Alex's app on port 4777, Sam's on 4778. To reach them over Tailscale, replace `127.0.0.1` with the server's Tailscale address.

## Git credentials

Git sync (pull content, commit and push events) runs the `git` binary inside the app, so your git config and credentials apply. The app stores no credentials. With npx it uses the credentials of the user running it. In a container, give git what it needs to reach your remote in one of these ways.

**SSH key.** Mount a deploy key and a `known_hosts` file read-only into the `node` user's home:

```yaml
    volumes:
      - /srv/learning/alex:/learning-home
      - /srv/keys/alex/id_ed25519:/home/node/.ssh/id_ed25519:ro
      - /srv/keys/alex/known_hosts:/home/node/.ssh/known_hosts:ro
```

The key file must belong to the user the container runs as and be readable only by it (`chmod 600`), or `ssh` ignores it. Use a remote URL such as `git@github.com:you/learning.git`. A deploy key limited to the one repository, with write access, is enough.

**HTTPS token.** Mount a git config that turns on the `store` credential helper, and a credentials file holding a token:

```yaml
    volumes:
      - /srv/learning/alex:/learning-home
      - /srv/keys/alex/gitconfig:/home/node/.gitconfig:ro
      - /srv/keys/alex/git-credentials:/home/node/.git-credentials:ro
```

```ini
# gitconfig
[credential]
	helper = store
[user]
	name = Alex's Tomewise
	email = alex@example.com
```

```text
# git-credentials
https://x-access-token:<token>@github.com
```

Use a fine-grained token limited to the one repository, with read and write access to contents.

**Commit identity.** Event commits need a `user.name` and `user.email`. Set them in the mounted git config (as above) or in the learning home's own `.git/config`.

**Ownership.** If the learning home belongs to a different uid than the container user, git refuses it as "dubious ownership". Run the container as the owner (`--user`, or `user:` in compose) rather than turning that check off.
