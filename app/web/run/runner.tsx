import { type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { Subject } from "../api.ts";
import { type Summary, type SubjectRun, summarize } from "./summary.ts";
import { type DrillDone, loadTome, setDrillContext, type Tome } from "./tome.ts";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "tome-drill": { key?: React.Key; ref?: React.Ref<HTMLElement>; drill?: string; close?: string; payload?: string };
    }
  }
}

export interface RunnerProps {
  subject: Subject;
  drill: string;
  ownsPage?: boolean;
  onDone?: (run: SubjectRun) => void;
}

export function Runner({ subject, drill, ownsPage = true, onDone }: RunnerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [tome, setTome] = useState<Tome>();
  const [error, setError] = useState<Error>();
  const [run, setRun] = useState(0);
  const [done, setDone] = useState<SubjectRun>();
  const element = useRef<HTMLElement>(null);
  const handOff = useRef(onDone);
  handOff.current = onDone;

  useEffect(() => {
    let current = true;
    let loaded: Tome | undefined;
    let clear: (() => void) | undefined;
    loadTome().then(
      (module) => {
        if (!current) return;
        loaded = module;
        if (ownsPage) clear = setDrillContext(subject.id, drill);
        setTome(module);
      },
      (failed: unknown) => current && setError(failed instanceof Error ? failed : new Error(String(failed))),
    );
    const leave = () => loaded?.end();
    addEventListener("pagehide", leave);
    return () => {
      current = false;
      removeEventListener("pagehide", leave);
      if (ownsPage) loaded?.end();
      clear?.();
    };
  }, [subject.id, drill, ownsPage]);

  useEffect(() => {
    const drillElement = element.current;
    if (!drillElement) return;
    const finished = (event: Event) => {
      event.preventDefault();
      const run = { ...(event as CustomEvent<DrillDone>).detail, subject };
      if (handOff.current) handOff.current(run);
      else setDone(run);
    };
    drillElement.addEventListener("tome-drill-done", finished);
    return () => drillElement.removeEventListener("tome-drill-done", finished);
  }, [tome, run, subject]);

  const close = () => (location.key === "default" ? navigate("/") : navigate(-1));

  const begin = (event: PointerEvent | KeyboardEvent) => {
    const target = event.target as Element;
    if (!tome || done || target.closest(".tome-close")) return;
    if (!element.current?.querySelector('.tome-drill[data-state="running"]')) return;
    void tome.start().catch(() => undefined);
  };

  const onClick = (event: MouseEvent) => {
    if (!(event.target as Element).closest(".tome-close")) return;
    event.preventDefault();
    close();
  };

  const again = () => {
    setDone(undefined);
    setRun((count) => count + 1);
  };

  const state = error ? "error" : !tome ? "loading" : done ? "done" : "running";
  return (
    <div className="tome-runner" data-state={state} onPointerDownCapture={begin} onKeyDownCapture={begin} onClick={onClick}>
      {error && (
        <p className="tome-notice" role="alert">
          {error.message}
        </p>
      )}
      {tome && <tome-drill key={run} ref={element} drill={drill} close="/" />}
      {done && (
        <RunSummary summary={summarize([done])} focus>
          {drill !== "review" && (
            <button type="button" className="tome-again" onClick={again}>
              Run again
            </button>
          )}
        </RunSummary>
      )}
    </div>
  );
}

export interface RunSummaryProps {
  summary: Summary;
  focus?: boolean;
  children?: ReactNode;
}

export function RunSummary({ summary, focus = false, children }: RunSummaryProps) {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) actions.current?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <section className="tome-runner-summary" aria-label="Summary">
      <div className="tome-summary-head">
        <span className="tome-kicker">{summary.timeUp ? "Time's up" : summary.subjects.length > 1 ? "All done" : "Session done"}</span>
        <span className="tome-score">{summary.score}</span>
        <span className="tome-score-sub">
          {summary.right} of {summary.answered} right
        </span>
      </div>
      <ul className="tome-stats">
        {summary.time !== undefined && (
          <li>
            <span>Time</span>
            <span>{summary.time}</span>
          </li>
        )}
        {summary.subjects.length > 1 &&
          summary.subjects.map((subject, index) => (
            <li key={`${index} ${subject.id}`}>
              <span>{subject.name}</span>
              <span>
                {subject.right} of {subject.answered}
              </span>
            </li>
          ))}
        {summary.answered < summary.planned && (
          <li>
            <span>Answered</span>
            <span>
              {summary.answered} of {summary.planned}
            </span>
          </li>
        )}
      </ul>
      <section className="tome-look-again" aria-label="Look at again">
        <h3>Look at again</h3>
        {summary.lookAgain.length ? (
          <ul>
            {summary.lookAgain.map((item) => (
              <li key={item.key}>
                <span className="tome-look-item">{item.label}</span>
                <span className="tome-look-why">{item.times > 1 ? `${item.why} · ${item.times}×` : item.why}</span>
                {item.lesson && <a href={item.lesson.href}>{item.lesson.title}</a>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="tome-hint">Nothing to look at again.</p>
        )}
      </section>
      <div className="tome-actions" ref={actions}>
        {children}
        <Link className="tome-back" to="/">
          Back to today
        </Link>
      </div>
    </section>
  );
}
