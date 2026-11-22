import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Home } from "./home/home.tsx";
import { Settings } from "./pages/settings.tsx";
import "./styles/app.css";

const pages: [string, ReactNode][] = [
  ["[data-styleguide-home]", <Home />],
  ["[data-styleguide-settings]", <Settings reloadForThemeScripts={false} />],
];

for (const [selector, page] of pages) {
  for (const mount of document.querySelectorAll(selector)) {
    createRoot(mount).render(
      <StrictMode>
        <MemoryRouter>{page}</MemoryRouter>
      </StrictMode>,
    );
  }
}
