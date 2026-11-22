import { Link, useSearchParams } from "react-router";
import { api, type Subject } from "../api.ts";
import { useLoad } from "../load.ts";
import { Runner } from "../run/runner.tsx";
import { Screen } from "../screen.tsx";

export function RunDue() {
  const subject = useSearchParams()[0].get("subject");
  if (subject) return <Run drill="review" load={() => api.subject(subject)} deps={[subject]} />;
  return (
    <Screen kicker="Review" title="Due today">
      <Link to="/">Back to today</Link>
    </Screen>
  );
}

export function RunDrill() {
  const params = useSearchParams()[0];
  const drill = params.get("drill");
  const subject = params.get("subject");
  if (!drill) {
    return (
      <Screen kicker="Drill" title="No drill chosen">
        <Link to="/">Back to today</Link>
      </Screen>
    );
  }
  return <Run drill={drill} load={() => subjectWithDrill(drill, subject)} deps={[drill, subject]} />;
}

async function subjectWithDrill(drill: string, id: string | null): Promise<Subject> {
  const has = (subject: Subject) => subject.drills.some((candidate) => candidate.id === drill);
  if (id) {
    const subject = await api.subject(id);
    if (has(subject)) return subject;
    throw new Error(`No drill "${drill}" in ${subject.name}. Drills: ${subject.drills.map((candidate) => candidate.id).join(", ")}.`);
  }
  const matches = (await api.subjects()).filter(has);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`No subject has a drill "${drill}".`);
  const ids = matches.map((subject) => subject.id).join(", ");
  throw new Error(`Several subjects have a drill "${drill}" (${ids}); add &subject= to the address to pick one.`);
}

function Run({ drill, load, deps }: { drill: string; load: () => Promise<Subject>; deps: unknown[] }) {
  const loaded = useLoad(load, deps);
  if (loaded.state === "ready") return <Runner key={`${loaded.data.id} ${drill}`} subject={loaded.data} drill={drill} />;
  return (
    <div className="tome-runner" data-state={loaded.state}>
      {loaded.state === "loading" ? (
        <p className="tome-hint">Loading…</p>
      ) : (
        <>
          <p className="tome-notice" role="alert">
            {loaded.error.message}
          </p>
          <Link className="tome-back" to="/">
            Back to today
          </Link>
        </>
      )}
    </div>
  );
}
