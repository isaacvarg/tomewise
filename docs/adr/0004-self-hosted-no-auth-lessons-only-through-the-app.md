# Self-hosted, no auth, and lessons are only opened through the app

Practice has to happen without talking to an agent or running a command each time, so an always-on app records results. It runs wherever the learner puts it (a laptop, a home server, a VPS), writing straight into the learning home, and ships as an OCI image (Docker or Podman) plus `npx`. A cloud host like Vercel was rejected: it has no persistent filesystem, which would break the plain-files decision (ADR 0002).

The app has **no auth** in v1: it is single-user and expected to sit on localhost or a private network such as Tailscale. Lessons are **only** opened through the app, which is what lets them report results. There is deliberately no offline queue in the browser: if the server is down, the learner brings it back up.

## Consequences

- Putting the app on a public VPS is unsupported in v1 and the docs must say so.
- In-app AI features (Feynman grading, generating lessons from a button) wait until auth exists.
- Storage sits behind one module so a hosted backend stays possible later.
