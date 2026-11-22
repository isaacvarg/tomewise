import { Link, useSearchParams } from "react-router";
import { Screen } from "../screen.tsx";

export function RunDue() {
  return (
    <Screen kicker="Review" title="Due today">
      <Link to="/">Back to today</Link>
    </Screen>
  );
}

export function RunDrill() {
  const drill = useSearchParams()[0].get("drill");
  return (
    <Screen kicker="Drill" title={drill ?? "No drill chosen"}>
      <Link to="/">Back to today</Link>
    </Screen>
  );
}
