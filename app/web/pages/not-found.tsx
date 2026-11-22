import { Link, useLocation } from "react-router";
import { Screen } from "../screen.tsx";

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <Screen title="Not found">
      <p className="tome-hint">There's no page at {pathname}.</p>
      <Link to="/">Back to today</Link>
    </Screen>
  );
}
