import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export type Change = { kind: "content" } | { kind: "events"; subjects: string[] };

interface Listener {
  change: (change: Change) => void;
  closed: () => void;
}

export interface Changes {
  announce: (change: Change) => void;
  listen: (listener: Listener) => () => void;
  close: () => void;
}

const RETRY_MS = 1000;

export function changeBus(): Changes {
  const listeners = new Set<Listener>();
  let closed = false;
  return {
    announce(change) {
      for (const listener of listeners) listener.change(change);
    },
    listen(listener) {
      if (closed) {
        listener.closed();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      for (const listener of listeners) listener.closed();
      listeners.clear();
    },
  };
}

export function changeRoutes(changes: Changes): Hono {
  const routes = new Hono();
  routes.get("/", (c) => {
    const response = streamSSE(c, async (stream) => {
      const pending: Change[] = [];
      let wake = () => {};
      let open = true;
      const stop = () => {
        open = false;
        wake();
      };
      const unlisten = changes.listen({
        change(change) {
          pending.push(change);
          wake();
        },
        closed: stop,
      });
      stream.onAbort(stop);
      await stream.write(`retry: ${RETRY_MS}\n\n`);
      while (open) {
        const change = pending.shift();
        if (change === undefined) {
          await new Promise<void>((resolve) => (wake = resolve));
          continue;
        }
        const { kind, ...data } = change;
        await stream.writeSSE({ event: kind, data: JSON.stringify(data) });
      }
      unlisten();
    });
    response.headers.set("Connection", "close");
    return response;
  });
  return routes;
}
