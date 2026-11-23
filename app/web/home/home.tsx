import { Link } from "react-router";
import type { Activity, Subject } from "../api.ts";
import { useLoad } from "../load.ts";
import { Heatmap } from "../heatmap.tsx";
import { Failed, Screen } from "../screen.tsx";
import { loadToday } from "../today.ts";
import { bySubjectsPractised, count, type DueToday, heatmapCells, longDate, type WeekStart } from "./model.ts";

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
      <Heatmap cells={heatmapCells(activity, weekStart, bySubjectsPractised(subjects.length))} weekStart={weekStart} label="Activity heatmap" />
      <Subjects subjects={subjects} />
      <Due due={due} />
      <Streak activity={activity} />
      <Start due={due} />
    </Screen>
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
