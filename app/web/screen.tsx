import type { ReactNode } from "react";
import type { Loaded } from "./load.ts";

export interface ScreenProps {
  back?: ReactNode;
  aside?: ReactNode;
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  state?: Loaded<unknown>["state"];
  children?: ReactNode;
}

export function Screen({ back, aside, kicker, title, lede, state = "ready", children }: ScreenProps) {
  return (
    <div className="tome-app" data-state={state}>
      <header className="tome-header">
        {back}
        {aside}
        {kicker && <p className="tome-kicker">{kicker}</p>}
        <h2 className="tome-title">{title}</h2>
        {lede && <p className="tome-lede">{lede}</p>}
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
