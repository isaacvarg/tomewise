export type ChangeKind = "content" | "events";

type Listener = (kind: ChangeKind | "reconnected") => void;

const RECONNECT_MS = 2000;

const listeners = new Set<Listener>();
let source: EventSource | undefined;

function notify(kind: ChangeKind | "reconnected") {
  for (const listener of listeners) listener(kind);
}

function connect(reconnecting = false) {
  source = new EventSource("/api/changes");
  let opened = reconnecting;
  source.addEventListener("open", () => {
    if (opened) notify("reconnected");
    opened = true;
  });
  source.addEventListener("error", function () {
    if (this.readyState !== EventSource.CLOSED) return;
    setTimeout(() => connect(true), RECONNECT_MS);
  });
  source.addEventListener("content", () => notify("content"));
  source.addEventListener("events", () => notify("events"));
}

export function onChange(listener: Listener): () => void {
  if (source === undefined) connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
