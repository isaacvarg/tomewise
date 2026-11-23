import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { count, type DueRow, type DueToday } from "../home/model.ts";
import { Runner, RunSummary } from "./runner.tsx";
import { type SubjectRun, summarize } from "./summary.ts";

type Step = { phase: "running"; at: number } | { phase: "break"; from: number } | { phase: "done" };

export function Sequence({ due }: { due: DueToday }) {
  const [queue, setQueue] = useState(due.rows);
  if (queue.length === 0 && due.rows.length > 0) setQueue(due.rows);
  const [runs, setRuns] = useState<SubjectRun[]>([]);
  const [step, setStep] = useState<Step>({ phase: "running", at: 0 });
  const live = new Map(due.rows.map((row) => [row.subject.id, row]));
  const upcoming = (from: number) => queue.findIndex((row, index) => index >= from && live.has(row.subject.id));

  if (queue.length === 0) return <NothingDue />;
  if (step.phase === "running") {
    const finished = (run: SubjectRun) => {
      setRuns((done) => [...done, run]);
      setStep({ phase: "break", from: step.at + 1 });
    };
    const { subject } = queue[step.at]!;
    return <Runner key={subject.id} subject={subject} drill="review" onDone={finished} />;
  }
  const next = step.phase === "break" ? upcoming(step.from) : -1;
  if (next === -1) {
    return (
      <div className="tome-runner" data-state="done">
        <RunSummary summary={summarize(runs)} focus />
      </div>
    );
  }
  return (
    <RunBreak
      run={runs.at(-1)!}
      next={live.get(queue[next]!.subject.id)!}
      onContinue={() => setStep({ phase: "running", at: next })}
      onSkip={() => setStep({ phase: "break", from: next + 1 })}
      onDone={() => setStep({ phase: "done" })}
      focus
    />
  );
}

export interface RunBreakProps {
  run: SubjectRun;
  next: DueRow;
  onContinue: () => void;
  onSkip: () => void;
  onDone: () => void;
  focus?: boolean;
}

export function RunBreak({ run, next, onContinue, onSkip, onDone, focus = false }: RunBreakProps) {
  const proceed = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus) proceed.current?.focus({ preventScroll: true });
  }, [focus]);
  const summary = summarize([run]);
  return (
    <div className="tome-runner" data-state="break">
      <section className="tome-break" aria-label="Break">
        <div className="tome-summary-head">
          <span className="tome-kicker">{run.subject.name}</span>
          <span className="tome-score">{summary.score}</span>
          <span className="tome-score-sub">
            {summary.right} of {summary.answered} right
          </span>
        </div>
        <p className="tome-break-next">
          Next: <strong>{next.subject.name}</strong>, {count(next.items, "item")}
        </p>
        <div className="tome-actions">
          <button type="button" className="tome-break-continue" ref={proceed} onClick={onContinue}>
            Continue
          </button>
          <button type="button" className="tome-break-skip" onClick={onSkip}>
            Skip
          </button>
          <button type="button" className="tome-break-done" onClick={onDone}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}

export function StartList({ due }: { due: DueToday }) {
  if (due.rows.length === 0) return <NothingDue />;
  return (
    <div className="tome-runner" data-state="ask">
      <section className="tome-section tome-picks" aria-label="What to review">
        <div className="tome-section-head">
          <h3>What to review</h3>
        </div>
        <ul>
          <li>
            <Link className="tome-pick" to="/run/due?all" data-all="">
              <span className="tome-pick-name">All, one after another</span>
              <span className="tome-pick-how">
                {count(due.items, "item")} · {due.minutes} min
              </span>
            </Link>
          </li>
          {due.rows.map((row) => (
            <li key={row.subject.id}>
              <Link className="tome-pick" to={`/run/due?subject=${encodeURIComponent(row.subject.id)}`} data-subject={row.subject.id}>
                <span className="tome-pick-name">{row.subject.name}</span>
                <span className="tome-pick-how">
                  {count(row.items, "item")} · {row.minutes} min
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <Link className="tome-back" to="/">
        Back to today
      </Link>
    </div>
  );
}

function NothingDue() {
  return (
    <div className="tome-runner" data-state="empty">
      <p className="tome-hint">Nothing due today.</p>
      <Link className="tome-back" to="/">
        Back to today
      </Link>
    </div>
  );
}
