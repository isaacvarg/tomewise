import type { ReactNode } from "react";
import type { Loaded } from "./load.ts";

export interface ScreenProps {
  kicker?: ReactNode;
  title: ReactNode;
  state?: Loaded<unknown>["state"];
  children?: ReactNode;
}

export function Screen({ kicker, title, state = "ready", children }: ScreenProps) {
  return (
    <div className="tome-app" data-state={state}>
      <header className="tome-header">
        {kicker && <p className="tome-kicker">{kicker}</p>}
        <h2 className="tome-title">{title}</h2>
      </header>
      {children}
    </div>
  );
}

export function Failed({ error }: { error: Error }) {
  return (
    <p className="tome-notice" role="alert">
      {error.message}
    </p>
  );
}
