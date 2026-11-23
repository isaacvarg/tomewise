import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { type Activity, type AgentPrompt, api, type DueItem, type Explanation, type Progress, type Subject, type SubjectPrompts } from "../api.ts";
import { Heatmap } from "../heatmap.tsx";
import { count, minutesFor } from "../home/model.ts";
import { useLoad } from "../load.ts";
import { Failed, Screen } from "../screen.tsx";
import { Stats } from "../subject/stats.tsx";
import {
  curriculumView,
  drillRows,
  goalProgress,
  type LessonRow,
  type MilestoneView,
  refName,
  sheetRows,
  subjectPath,
  subjectHeatmap,
  TABS,
  tabPath,
  type View,
  viewOf,
  weekdayName,
} from "../subject/model.ts";
import { glossaryDetail } from "../subject/glossary.ts";
import { NotFound } from "./not-found.tsx";

interface SubjectData {
  subject: Subject;
  activity: Activity;
  progress: Progress;
  due: DueItem[];
  prompts: SubjectPrompts;
}

async function loadSubjectHome(id: string): Promise<SubjectData> {
  const [subject, activity, progress, prompts] = await Promise.all([
    api.subject(id),
    api.activity(id),
    api.progress(id),
    api.prompts(id),
  ]);
  return { subject, activity, progress, prompts, due: await api.due(id, activity.today) };
}

const backLink = (
  <Link className="tome-home-link" to="/">
    Today
  </Link>
);

function Title({ name }: { name: string }) {
  return (
    <>
      <span className="tome-mark tome-mark-letter" aria-hidden="true">
        {Array.from(name)[0]?.toLocaleUpperCase()}
      </span>
      {name}
    </>
  );
}

export function SubjectHome() {
  const params = useParams();
  const id = params.subject!;
  const view = viewOf(params.tab);
  const loaded = useLoad(() => loadSubjectHome(id), [id], { refetchOn: ["content", "events"] });
  if (view === undefined) return <NotFound />;
  if (loaded.state !== "ready") {
    return (
      <Screen back={backLink} kicker="Subject" title={id} state={loaded.state}>
        {loaded.state === "loading" ? <p className="tome-hint">Loading…</p> : <Failed error={loaded.error} />}
      </Screen>
    );
  }
  const data = loaded.data;
  return (
    <Screen back={backLink} kicker="Subject" title={<Title name={data.subject.name} />}>
      <Tabs data={data} view={view} />
    </Screen>
  );
}

function Tabs({ data, view }: { data: SubjectData; view: View }) {
  const prefix = useId();
  const navigate = useNavigate();
  const tabs = useRef<(HTMLAnchorElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent) => {
    const from = tabs.current.indexOf(event.target as HTMLAnchorElement);
    const moves: Record<string, number> = { ArrowRight: from + 1, ArrowLeft: from - 1, Home: 0, End: TABS.length - 1 };
    const to = moves[event.key];
    if (from === -1 || to === undefined) return;
    event.preventDefault();
    const next = (to + TABS.length) % TABS.length;
    navigate(tabPath(data.subject.id, TABS[next]!.view));
    tabs.current[next]?.focus();
  };
  const panels: Record<View, () => ReactNode> = {
    overview: () => <Overview data={data} />,
    curriculum: () => <Curriculum data={data} />,
    drills: () => <Drills data={data} />,
    reference: () => <Reference data={data} />,
    stats: () => <Stats subject={data.subject.id} />,
  };
  return (
    <>
      <nav className="tome-tabs" role="tablist" aria-label={data.subject.name} onKeyDown={onKeyDown}>
        {TABS.map((tab, index) => (
          <Link
            key={tab.view}
            ref={(element) => void (tabs.current[index] = element)}
            id={`${prefix}-tab-${tab.view}`}
            className="tome-tab"
            role="tab"
            to={tabPath(data.subject.id, tab.view)}
            aria-selected={tab.view === view}
            aria-controls={`${prefix}-view-${tab.view}`}
            tabIndex={tab.view === view ? 0 : -1}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {TABS.map((tab) => (
        <div
          key={tab.view}
          id={`${prefix}-view-${tab.view}`}
          className={tab.view === "overview" ? "tome-view tome-overview" : "tome-view"}
          role="tabpanel"
          data-view={tab.view}
          aria-labelledby={`${prefix}-tab-${tab.view}`}
          hidden={tab.view !== view}
        >
          {tab.view === view && panels[tab.view]()}
        </div>
      ))}
    </>
  );
}

function Overview({ data }: { data: SubjectData }) {
  const { subject, activity } = data;
  const streak = activity.streak.days;
  return (
    <>
      <Goal data={data} />
      <Heatmap
        cells={subjectHeatmap(activity, subject.settings.weekStart)}
        weekStart={subject.settings.weekStart}
        label={`${subject.name} activity heatmap`}
        meta={streak > 0 && ` · ${count(streak, "day")} in a row`}
      />
      <Prompts subject={data.subject} prompts={data.prompts.prompts} />
      <Due data={data} />
      <Feedback explanations={data.prompts.explanations} />
    </>
  );
}

function Goal({ data }: { data: SubjectData }) {
  const progress = goalProgress(data.subject, data.activity);
  if (!progress) {
    return (
      <section className="tome-section tome-goal" aria-label="Goal">
        <div className="tome-section-head">
          <h3>Goal</h3>
        </div>
        <p className="tome-hint">No goal yet. Ask your agent to suggest one.</p>
      </section>
    );
  }
  const { goal, minutes, toGo, week } = progress;
  const period = goal.per === "day" ? "today" : "this week";
  const weekStart = data.subject.settings.weekStart;
  const met = week?.flatMap((day, index) => (day.state === "met" ? [weekdayName(index, weekStart)] : [])) ?? [];
  return (
    <section className="tome-section tome-goal" aria-label="Goal">
      <div className="tome-section-head">
        <h3>Goal</h3>
        <span className="tome-meta">
          {goal.minutes} min a {goal.per}
        </span>
      </div>
      <div className="tome-goal-num">
        <b>{minutes}</b>
        <span>
          of {goal.minutes} min {period} · {toGo === 0 ? "done" : `${toGo} to go`}
        </span>
      </div>
      <div className="tome-goal-bar" role="img" aria-label={`${minutes} of ${goal.minutes} minutes`}>
        <span style={{ width: `${Math.min(100, (100 * minutes) / goal.minutes)}%` }} />
      </div>
      {week && (
        <div
          className="tome-goal-week"
          role="img"
          aria-label={met.length === 0 ? "This week: goal not met yet" : `This week: goal met ${listed(met)}`}
        >
          {week.map((day, index) => (
            <span key={index} data-today={day.today ? "" : undefined}>
              <i data-met={day.state === "met" ? "" : undefined} data-part={day.state === "part" ? "" : undefined} />
              {day.letter}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function listed(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function Prompts({ subject, prompts }: { subject: Subject; prompts: AgentPrompt[] }) {
  if (prompts.length === 0) return null;
  return (
    <section className="tome-section tome-prompts">
      <div className="tome-section-head">
        <h3>Ask your agent</h3>
        <span className="tome-meta">{prompts.length} waiting</span>
      </div>
      <ul>
        {prompts.map((prompt) => (
          <li key={promptKey(prompt)} className="tome-ask" data-prompt={prompt.kind}>
            <p>
              <PromptText subject={subject} prompt={prompt} />
            </p>
            <Say text={prompt.say} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const promptKey = (prompt: AgentPrompt) => (prompt.kind === "ungraded-explanations" ? prompt.kind : `${prompt.kind}:${prompt.milestone.id}`);

function PromptText({ subject, prompt }: { subject: Subject; prompt: AgentPrompt }) {
  switch (prompt.kind) {
    case "milestone-done":
      return (
        <>
          Every lesson in <strong>{prompt.milestone.title}</strong> is done.
        </>
      );
    case "exam-unwritten":
      return (
        <>
          Every lesson in <strong>{prompt.milestone.title}</strong> is done. Its exam isn't written yet.
        </>
      );
    case "exam-ready":
      return (
        <>
          The exam for <strong>{prompt.milestone.title}</strong> is ready.{" "}
          <a className="tome-ask-go" href={subjectPath(subject.id, "exams", `${prompt.exam}.html`)}>
            Take the exam
          </a>
        </>
      );
    case "ungraded-explanations": {
      const several = prompt.count > 1;
      const names = prompt.refs.map((ref) => <strong key={ref}>{refName(ref)}</strong>);
      return (
        <>
          Your {several ? "explanations" : "explanation"} from {joined(names)} {several ? "are" : "is"} waiting to be graded.
        </>
      );
    }
  }
}

function joined(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [index === parts.length - 1 ? " and " : ", ", part]));
}

function Say({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return (
    <div className="tome-ask-say">
      <span>{text}</span>
      {clipboard && (
        <button className="tome-copy" type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

const FEEDBACK_SHOWN = 3;

export function Feedback({ explanations }: { explanations: Explanation[] }) {
  const graded = explanations
    .filter((explanation) => explanation.grade !== undefined)
    .sort((a, b) => b.grade!.ts.localeCompare(a.grade!.ts));
  if (graded.length === 0) return null;
  return (
    <section className="tome-section tome-explanations">
      <div className="tome-section-head">
        <h3>Feedback</h3>
        <span className="tome-meta">{graded.length > FEEDBACK_SHOWN ? `latest ${FEEDBACK_SHOWN} of ${graded.length}` : count(graded.length, "explanation")}</span>
      </div>
      <ul>
        {graded.slice(0, FEEDBACK_SHOWN).map((explanation) => (
          <li key={explanation.id} className="tome-explanation">
            <p className="tome-hint">
              Your explanation of <b className="tome-explanation-from">{refName(explanation.ref)}</b>
            </p>
            <blockquote className="tome-explanation-text">{explanation.text}</blockquote>
            <p className="tome-explanation-feedback">
              <b>Your agent</b> {explanation.grade!.feedback}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Due({ data }: { data: SubjectData }) {
  const { subject, due } = data;
  const minutes = minutesFor(due.length);
  return (
    <section className="tome-section tome-due">
      <div className="tome-section-head">
        <h3>Due here</h3>
        <span className="tome-meta">{count(due.length, "item")}</span>
      </div>
      {due.length === 0 ? (
        <p className="tome-hint">Nothing due here today.</p>
      ) : (
        <ul>
          <li>
            <span className="tome-due-what">Review</span>
            <span className="tome-due-how">
              {count(due.length, "item")} · {minutes} min
            </span>
          </li>
        </ul>
      )}
      {due.length === 0 ? (
        <a className="tome-start" aria-disabled="true">
          Start {subject.name} <small>nothing due</small>
        </a>
      ) : (
        <Link className="tome-start" to={`/run/due?subject=${encodeURIComponent(subject.id)}`}>
          Start {subject.name}{" "}
          <small>
            {count(due.length, "item")}, about {minutes} min
          </small>
        </Link>
      )}
      {subject.settings.assessments.enabled && (
        <Link className="tome-quiz-me" to={`/run/quiz?subject=${encodeURIComponent(subject.id)}`}>
          Quiz me
        </Link>
      )}
    </section>
  );
}

const CHECK = (
  <svg viewBox="0 0 12 12" role="img" aria-label="Done">
    <path d="M2.5 6.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const STATUS: Record<MilestoneView["status"], string> = {
  done: "Done",
  current: "Current",
  upcoming: "Upcoming",
  skipped: "Skipped",
  changed: "Changed",
};

function Curriculum({ data }: { data: SubjectData }) {
  const view = curriculumView(data.subject, data.progress.completedLessons, data.progress.milestones);
  const hasCurriculum = data.subject.curriculum !== undefined;
  return (
    <section className="tome-section tome-curriculum" aria-label="Curriculum">
      <div className="tome-section-head">
        <h3>Curriculum</h3>
        <span className="tome-meta">
          {view.done} of {count(view.total, "lesson")} done
        </span>
      </div>
      {view.total === 0 && !hasCurriculum && <p className="tome-hint">No lessons yet. Ask your agent for the first one.</p>}
      {view.units.map((unit) => (
        <div key={unit.title} className="tome-unit">
          <h4>{unit.title}</h4>
          {unit.milestones.map((milestone) => (
            <div key={milestone.id} className="tome-milestone" data-milestone={milestone.id}>
              <div className="tome-milestone-head">
                <b>{milestone.title}</b>
                <span className="tome-status" data-status={milestone.status}>
                  {STATUS[milestone.status]}
                </span>
              </div>
              {(milestone.lessons.length > 0 || milestone.exam) && (
                <ol className="tome-lessons">
                  {milestone.lessons.map((lesson) => (
                    <Lesson key={lesson.id} lesson={lesson} />
                  ))}
                  {milestone.exam && <Exam exam={milestone.exam} />}
                </ol>
              )}
            </div>
          ))}
        </div>
      ))}
      {view.other.length > 0 && (
        <div className="tome-unit">
          <h4>{hasCurriculum ? "Other lessons" : "Lessons"}</h4>
          <div className="tome-milestone tome-milestone-plain">
            <ol className="tome-lessons">
              {view.other.map((lesson) => (
                <Lesson key={lesson.id} lesson={lesson} />
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

function Lesson({ lesson }: { lesson: LessonRow }) {
  return (
    <li data-lesson={lesson.id} data-done={lesson.done ? "" : undefined} data-later={lesson.later !== undefined ? "" : undefined}>
      <a className="tome-row" href={lesson.href}>
        <span className="tome-check">{lesson.done && CHECK}</span>
        <span>
          {lesson.name.number !== undefined && <span className="tome-num">{lesson.name.number}</span>}
          {lesson.name.title}
        </span>
        <span className="tome-side">{lesson.later ?? (lesson.items > 0 ? count(lesson.items, "item") : "")}</span>
      </a>
    </li>
  );
}

function Exam({ exam }: { exam: NonNullable<MilestoneView["exam"]> }) {
  const content = (
    <>
      <span className="tome-check" />
      <span>{exam.title}</span>
      <span className="tome-side">{exam.href ? "Ready" : "Ask your agent"}</span>
    </>
  );
  return (
    <li className="tome-exam">
      {exam.href ? (
        <a className="tome-row" href={exam.href}>
          {content}
        </a>
      ) : (
        <span className="tome-row">{content}</span>
      )}
    </li>
  );
}

interface CardProps {
  name: string;
  detail: string;
  action: string;
  to?: string;
  href?: string;
}

function Card({ name, detail, action, to, href }: CardProps) {
  const content = (
    <>
      <span className="tome-drill-name">
        {name}
        <span className="tome-drill-sub">{detail}</span>
      </span>
      <span className="tome-drill-go">{action}</span>
    </>
  );
  if (to !== undefined) {
    return (
      <Link className="tome-row" to={to}>
        {content}
      </Link>
    );
  }
  if (href !== undefined) {
    return (
      <a className="tome-row" href={href}>
        {content}
      </a>
    );
  }
  return (
    <span className="tome-row" aria-disabled="true">
      {content}
    </span>
  );
}

function Drills({ data }: { data: SubjectData }) {
  const rows = drillRows(data.subject, data.progress.completedLessons);
  const ready = rows.filter((row) => row.locked === undefined).length;
  return (
    <section className="tome-section tome-drills">
      <div className="tome-section-head">
        <h3>Drills</h3>
        <span className="tome-meta">
          {ready} of {rows.length} ready
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="tome-hint">No drills yet. Ask your agent for one.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id} data-drill={row.id} data-locked={row.locked !== undefined ? "" : undefined}>
              {row.locked === undefined ? (
                <Card name={row.name} detail={row.detail} action="Run" to={row.href} />
              ) : (
                <Card name={row.name} detail={row.detail} action={row.locked} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Glossary({ data }: { data: SubjectData }) {
  return (
    <li data-sheet="glossary">
      <Card name="Glossary" detail={glossaryDetail(data.subject, data.progress.completedLessons)} action="Open" to={subjectPath(data.subject.id, "glossary")} />
    </li>
  );
}

function Reference({ data }: { data: SubjectData }) {
  const sheets = sheetRows(data.subject);
  return (
    <section className="tome-section tome-reference">
      <div className="tome-section-head">
        <h3>Reference</h3>
        <span className="tome-meta">{sheets.length + 1}</span>
      </div>
      <ul>
        <Glossary data={data} />
        {sheets.map((sheet) => (
          <li key={sheet.id} data-sheet={sheet.id}>
            <Card name={sheet.name} detail="Sheet from your agent" action="Open" href={sheet.href} />
          </li>
        ))}
      </ul>
      {sheets.length === 0 && <p className="tome-hint">No reference sheets yet.</p>}
    </section>
  );
}
