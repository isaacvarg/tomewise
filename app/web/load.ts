import { useEffect, useState } from "react";

export type Loaded<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: Error };

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[] = []): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    let current = true;
    setLoaded({ state: "loading" });
    load().then(
      (data) => current && setLoaded({ state: "ready", data }),
      (error: unknown) => current && setLoaded({ state: "error", error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      current = false;
    };
  }, deps);
  return loaded;
}
