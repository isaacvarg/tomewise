import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Home } from "./home/home.tsx";
import "./styles/app.css";

for (const mount of document.querySelectorAll("[data-styleguide-home]")) {
  createRoot(mount).render(
    <StrictMode>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </StrictMode>,
  );
}
