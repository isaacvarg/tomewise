import { Link } from "react-router";
import { Screen } from "../screen.tsx";

export function Settings() {
  return (
    <Screen title="Settings">
      <Link to="/">Back to today</Link>
    </Screen>
  );
}
