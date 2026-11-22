import type { Item, LearningEvent, Subject } from "@tomewise/core";
import { clearUnsaved, showUnsaved } from "./notice.ts";

export type PageKind = "lesson" | "quiz" | "exam" | "drill";
export type Outcome = "correct" | "wrong" | "skipped";
export type Grade = 1 | 2 | 3 | 4;

export interface PageContext {
  subject: string;
  kind: PageKind;
  id: string;
}

export interface AttemptInput {
  ref: string;
  outcome: Outcome;
  grade: Grade;
  duration?: number;
  data?: Record<string, unknown>;
}

export interface Issue {
  path: string;
  message: string;
}

export class TomeError extends Error {
  readonly issues: Issue[];

  constructor(message: string, issues: Issue[] = []) {
    super(message);
    this.name = "TomeError";
    this.issues = issues;
  }
}

const PAGE_KINDS: readonly PageKind[] = ["lesson", "quiz", "exam", "drill"];
const EVENTS_URL = "/api/events";
const UNREACHABLE = "Couldn't reach the app, so this wasn't saved. Check the app is running, then try again.";

function meta(doc: Document, name: string): string | undefined {
  return doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
}

export function readPageContext(doc: Document): PageContext | undefined {
  const subject = meta(doc, "tome-subject");
  if (!subject) return undefined;
  const kind = (meta(doc, "tome-page-kind") ?? "lesson") as PageKind;
  if (!PAGE_KINDS.includes(kind)) return undefined;
  const id = meta(doc, `tome-${kind}`);
  return id ? { subject, kind, id } : undefined;
}

interface Session {
  id: string;
  startedAt: number;
}

export class Tome {
  readonly #window: Window;
  #subject?: Promise<Subject>;
  #schemaVersion?: number;
  #session?: Promise<Session>;
  #current?: Session;
  #watching = false;
  #completion?: Promise<LearningEvent>;

  constructor(win: Window = window) {
    this.#window = win;
  }

  get context(): PageContext {
    const context = readPageContext(this.#window.document);
    if (!context) throw new TomeError("This page has no Tomewise page context; open it through the app.");
    return context;
  }

  get page(): string {
    const { kind, id } = this.context;
    return `${kind}:${id}`;
  }

  subject(): Promise<Subject> {
    this.#subject ??= this.#loadSubject().catch((error: unknown) => {
      this.#subject = undefined;
      throw error;
    });
    return this.#subject;
  }

  async item(ref: string): Promise<Item> {
    const id = /^item:(.+)$/.exec(ref)?.[1];
    if (!id) throw new TomeError(`"${ref}" is not an item ref; write it as item:<id>, such as item:letter-k.`);
    const subject = await this.subject();
    const item = subject.items.find((candidate) => candidate.id === id);
    if (!item) throw new TomeError(`No item "${id}" in ${subject.name}.`);
    return item;
  }

  async due(): Promise<Item[]> {
    const { due } = await this.#get<{ due: { item: Item }[] }>("due");
    return due.map(({ item }) => item);
  }

  async unlocked(): Promise<Item[]> {
    const [subject, { events }] = await Promise.all([this.subject(), this.#get<{ events: LearningEvent[] }>("events")]);
    const completed = new Set(
      events.filter((event) => event.kind === "lesson.completed").map((event) => event.ref?.replace(/^lesson:/, "")),
    );
    return subject.items.filter(
      (item) => !item.retired && (item.unlockedBy === undefined || completed.has(item.unlockedBy)),
    );
  }

  start(): Promise<Session> {
    this.#session ??= this.#postStart().catch((error: unknown) => {
      this.#session = undefined;
      throw error;
    });
    return this.#session;
  }

  async attempt(input: AttemptInput, widget?: Element): Promise<LearningEvent> {
    if (widget) clearUnsaved(widget);
    try {
      return await this.#postAttempt(input);
    } catch (error) {
      if (widget) showUnsaved(widget, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async #postAttempt({ ref, outcome, grade, duration, data = {} }: AttemptInput): Promise<LearningEvent> {
    const session = await this.start();
    return this.#post({
      kind: "attempt",
      ref,
      sessionId: session.id,
      outcome,
      grade,
      ...(duration !== undefined && { duration: Math.max(0, Math.round(duration)) }),
      data,
    });
  }

  complete(): Promise<LearningEvent> {
    this.#completion ??= this.#postCompleted().catch((error: unknown) => {
      this.#completion = undefined;
      throw error;
    });
    return this.#completion;
  }

  end(): void {
    const session = this.#current;
    if (!session || this.#schemaVersion === undefined) return;
    this.#current = undefined;
    this.#session = undefined;
    const event = this.#envelope({
      kind: "session.end",
      ref: this.page,
      sessionId: session.id,
      duration: Math.max(0, Math.round(this.#window.performance.now() - session.startedAt)),
      data: {},
    });
    const body = new Blob([JSON.stringify(event)], { type: "application/json" });
    if (!this.#window.navigator.sendBeacon?.(EVENTS_URL, body)) {
      void this.#window.fetch(EVENTS_URL, { method: "POST", body, keepalive: true }).catch(() => undefined);
    }
  }

  watch(): void {
    if (this.#watching || !readPageContext(this.#window.document)) return;
    this.#watching = true;
    const begin = () => {
      if (!this.#completion) void this.start().catch(() => undefined);
    };
    for (const type of ["pointerdown", "keydown"]) {
      this.#window.addEventListener(type, begin, { capture: true, passive: true });
    }
    this.#window.addEventListener("pagehide", () => this.end());
  }

  async #loadSubject(): Promise<Subject> {
    const { subject } = this.context;
    let response: Response;
    try {
      response = await this.#window.fetch(`/api/subjects/${encodeURIComponent(subject)}`);
    } catch {
      throw new TomeError(UNREACHABLE);
    }
    if (!response.ok) throw new TomeError(`Couldn't load subject "${subject}" (the app answered ${response.status}).`);
    const loaded = (await response.json()) as Subject;
    this.#schemaVersion = Math.max(...loaded.payloadSchemas.map((schema) => schema.version));
    return loaded;
  }

  async #get<T>(path: string): Promise<T> {
    const { subject } = this.context;
    let response: Response;
    try {
      response = await this.#window.fetch(`/api/subjects/${encodeURIComponent(subject)}/${path}`);
    } catch {
      throw new TomeError(UNREACHABLE);
    }
    if (!response.ok) throw new TomeError(`Couldn't load ${path} for "${subject}" (the app answered ${response.status}).`);
    return (await response.json()) as T;
  }

  async #postStart(): Promise<Session> {
    await this.subject();
    const startedAt = this.#window.performance.now();
    const event = await this.#post({ kind: "session.start", ref: this.page, data: {} });
    this.#current = { id: event.id, startedAt };
    return this.#current;
  }

  async #postCompleted(): Promise<LearningEvent> {
    const { kind } = this.context;
    if (kind !== "lesson") throw new TomeError(`Only a lesson can be completed; this page is a ${kind}.`);
    const session = await this.start();
    const event = await this.#post({ kind: "lesson.completed", ref: this.page, sessionId: session.id, data: {} });
    this.end();
    return event;
  }

  #envelope(fields: Record<string, unknown>): Record<string, unknown> {
    return { subject: this.context.subject, schemaVersion: this.#schemaVersion, ...fields };
  }

  async #post(fields: Record<string, unknown>): Promise<LearningEvent> {
    let response: Response;
    try {
      response = await this.#window.fetch(EVENTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.#envelope(fields)),
      });
    } catch {
      throw new TomeError(UNREACHABLE);
    }
    const body = (await response.json().catch(() => undefined)) as
      | { events?: LearningEvent[]; issues?: Issue[] }
      | undefined;
    if (response.status === 201 && body?.events?.[0]) return body.events[0];
    if (response.status === 400 && body?.issues) {
      const details = body.issues.map((issue) => `${issue.path ? `${issue.path}: ` : ""}${issue.message}`).join("; ");
      throw new TomeError(`The app didn't accept this: ${details}`, body.issues);
    }
    throw new TomeError(`The app answered ${response.status}, so this wasn't saved.`);
  }
}

export const tome = new Tome();
