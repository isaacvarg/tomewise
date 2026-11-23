export type Outcome = "correct" | "wrong" | "skipped";

export interface Answered {
  ref: string;
  outcome: Outcome;
  grade: 1 | 2 | 3 | 4;
  duration: number;
  given?: string;
}

export interface EndedSession {
  sessionId: string;
  duration: number;
}

export interface DrillDone {
  drill: string;
  planned: number;
  timeUp: boolean;
  results: Answered[];
  session: EndedSession | undefined;
}

export interface Tome {
  start(): Promise<unknown>;
  end(): EndedSession | undefined;
}

const TOME_JS = "/widgets/v1/tome.js";
const CONTEXT = ["tome-subject", "tome-page-kind", "tome-drill"] as const;

let loading: Promise<Tome> | undefined;

export function loadTome(): Promise<Tome> {
  loading ??= (import(TOME_JS) as Promise<{ tome: Tome }>).then(
    (module) => module.tome,
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

export function setDrillContext(subject: string, drill: string): () => void {
  const values = [subject, "drill", drill];
  const metas = CONTEXT.map((name, index) => {
    const meta = document.createElement("meta");
    meta.name = name;
    meta.content = values[index]!;
    document.head.append(meta);
    return meta;
  });
  return () => metas.forEach((meta) => meta.remove());
}
