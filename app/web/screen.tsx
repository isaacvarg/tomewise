import type { ReactNode } from "react";
import type { Loaded } from "./load.ts";

export interface ScreenProps {
  back?: ReactNode;
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  state?: Loaded<unknown>["state"];
  children?: ReactNode;
}

export function Screen({ back, kicker, title, lede, state = "ready", children }: ScreenProps) {
  return (
    <div className="tome-app" data-state={state}>
      <header className="tome-header">
        {back}
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
