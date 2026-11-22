import { watch } from "node:fs";
import { sep } from "node:path";
import { type LearningHome, loadLearningHome, loadSubject, type Subject } from "@tomewise/core";

export interface HomeView {
  home: LearningHome;
  subjects: Map<string, Subject>;
}

export type ReloadListener = (next: HomeView, previous: HomeView) => void | Promise<void>;

export interface WatchedHome {
  current: () => HomeView;
  onReload: (listener: ReloadListener) => () => void;
  close: () => Promise<void>;
}

export interface WatchOptions {
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

export async function loadView(home: LearningHome): Promise<HomeView> {
  const subjects = new Map<string, Subject>();
  for (const id of home.subjects) subjects.set(id, await loadSubject(home, id));
  return { home, subjects };
}

function ignored(file: string | null): boolean {
  if (file === null) return false;
  const parts = file.split(sep);
  if (parts[0] === ".git") return true;
  return parts[0] === "subjects" && parts[2] === "events";
}

export async function watchLearningHome(home: LearningHome, options: WatchOptions = {}): Promise<WatchedHome> {
  const { debounceMs = 50, onError = (error) => console.error(`Reloading ${home.root} failed:`, error) } = options;
  let view = await loadView(home);
  const listeners = new Set<ReloadListener>();
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let closed = false;

  async function reload() {
    if (closed) return;
    try {
      const next = await loadView(await loadLearningHome(home.root));
      if (closed) return;
      const previous = view;
      view = next;
      for (const listener of listeners) await listener(next, previous);
    } catch (error) {
      onError(error);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      running = running.then(reload);
    }, debounceMs);
  }

  const watcher = watch(home.root, { recursive: true }, (_event, file) => {
    if (!ignored(file)) schedule();
  });
  watcher.on("error", onError);

  return {
    current: () => view,
    onReload(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      timer = undefined;
      watcher.close();
      await running;
    },
  };
}
