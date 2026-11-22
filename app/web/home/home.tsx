import { Link } from "react-router";
import type { Activity, Subject } from "../api.ts";
import { useLoad } from "../load.ts";
import { Failed, Screen } from "../screen.tsx";
import { loadToday } from "../today.ts";
import { count, type DueToday, heatmapCells, longDate, NARROW_WEEKS, type WeekStart, weekdayLetters } from "./model.ts";

export function Home() {
  const loaded = useLoad(loadToday, [], { refetchOn: ["content", "events"] });
  if (loaded.state === "loading") {
    return (
      <Screen title="Today" state="loading">
        <p className="tome-hint">Loading…</p>
      </Screen>
    );
  }
  if (loaded.state === "error") {
    return (
      <Screen title="Today" state="error">
        <Failed error={loaded.error} />
      </Screen>
    );
  }
  const { subjects, activity, due } = loaded.data;
  const weekStart: WeekStart = subjects[0]?.settings.weekStart ?? "monday";
  return (
    <Screen kicker={longDate(activity.today)} title="Today">
      <Heatmap activity={activity} weekStart={weekStart} subjectCount={subjects.length} />
      <Subjects subjects={subjects} />
      <Due due={due} />
      <Streak activity={activity} />
      <Start due={due} />
    </Screen>
  );
}

function Heatmap({ activity, weekStart, subjectCount }: { activity: Activity; weekStart: WeekStart; subjectCount: number }) {
  return (
    <section className="tome-section tome-activity" aria-label="Activity">
      <div className="tome-section-head">
        <h3>Activity</h3>
        <span className="tome-meta">
          <span className="tome-meta-narrow">Last {NARROW_WEEKS} weeks</span>
          <span className="tome-meta-wide">Last 12 months</span>
        </span>
      </div>
      <div className="tome-heatmap-wrap">
        <div className="tome-heat-days" aria-hidden="true">
          {weekdayLetters(weekStart).map((letter, index) => (
            <span key={index}>{letter}</span>
          ))}
        </div>
        <div className="tome-heatmap" role="img" aria-label="Activity heatmap">
          {heatmapCells(activity, weekStart, subjectCount).map((cell) => (
            <i
              key={cell.date}
              className="tome-cell"
              data-date={cell.date}
              data-level={cell.level > 0 ? cell.level : undefined}
              data-today={cell.today ? "" : undefined}
              data-future={cell.future ? "" : undefined}
              data-old={cell.old ? "" : undefined}
            />
          ))}
        </div>
      </div>
      <div className="tome-heat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className="tome-cell" data-level={level > 0 ? level : undefined} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}

function Subjects({ subjects }: { subjects: Subject[] }) {
  return (
    <nav className="tome-subjects" aria-label="Subjects">
      {subjects.map((subject) => (
        <Link key={subject.id} className="tome-subject" to={`/s/${encodeURIComponent(subject.id)}`}>
          <span className="tome-mark tome-mark-letter" aria-hidden="true">
            {Array.from(subject.name)[0]?.toLocaleUpperCase()}
          </span>
          <span className="tome-subject-name">{subject.name}</span>
        </Link>
      ))}
    </nav>
  );
}

function Due({ due }: { due: DueToday }) {
  return (
    <section className="tome-section tome-due">
      <div className="tome-section-head">
        <h3>Due today</h3>
        <span className="tome-meta">{count(due.items, "item")}</span>
      </div>
      {due.rows.length === 0 ? (
        <p className="tome-hint">Nothing due today.</p>
      ) : (
        <ul>
          {due.rows.map((row) => (
            <li key={row.subject.id}>
              <span className="tome-due-what">{row.subject.name}</span>
              <span className="tome-due-how">
                {count(row.items, "item")} · {row.minutes} min
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Streak({ activity }: { activity: Activity }) {
  const { days, restDaysLeft } = activity.streak;
  return (
    <section className="tome-streak" aria-label="Streak">
      <span className="tome-streak-num">{days}</span>
      <span className="tome-streak-text">
        <strong>day streak</strong>
        {` · ${restDaysLeft === 0 ? "no rest days" : count(restDaysLeft, "rest day")} left this week`}
      </span>
    </section>
  );
}

function Start({ due }: { due: DueToday }) {
  if (due.items === 0) {
    return (
      <a className="tome-start" aria-disabled="true">
        Start <small>nothing due</small>
      </a>
    );
  }
  return (
    <Link className="tome-start" to="/run/due">
      Start{" "}
      <small>
        {count(due.items, "item")}, about {due.minutes} min
      </small>
    </Link>
  );
}
