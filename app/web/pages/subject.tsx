import { Link, useParams } from "react-router";
import { api } from "../api.ts";
import { useLoad } from "../load.ts";
import { Failed, Screen } from "../screen.tsx";

export function SubjectHome() {
  const id = useParams().subject!;
  const loaded = useLoad(() => api.subject(id), [id]);
  return (
    <Screen kicker="Subject" title={loaded.state === "ready" ? loaded.data.name : id} state={loaded.state}>
      {loaded.state === "error" && <Failed error={loaded.error} />}
      <Link to="/">Back to today</Link>
    </Screen>
  );
}
