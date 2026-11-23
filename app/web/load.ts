import { useEffect, useState } from "react";
import { type ChangeKind, onChange } from "./changes.ts";

export type Loaded<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: Error };

export function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface LoadOptions {
  refetchOn?: readonly ChangeKind[];
}

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[] = [], { refetchOn = [] }: LoadOptions = {}): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const watched = refetchOn.join(" ");
  useEffect(() => {
    let latest = 0;
    function fetch() {
      const run = ++latest;
      load().then(
        (data) => run === latest && setLoaded({ state: "ready", data }),
        (error: unknown) =>
          run === latest &&
          setLoaded((previous) =>
            previous.state === "ready" ? previous : { state: "error", error: errorOf(error) },
          ),
      );
    }
    setLoaded({ state: "loading" });
    fetch();
    const stop =
      refetchOn.length === 0 ? () => {} : onChange((kind) => (kind === "reconnected" || refetchOn.includes(kind)) && fetch());
    return () => {
      latest = -1;
      stop();
    };
  }, [...deps, watched]);
  return loaded;
}
