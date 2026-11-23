import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Subject } from "./api.ts";
import { dueToday } from "./home/model.ts";
import { Home } from "./home/home.tsx";
import { Settings } from "./pages/settings.tsx";
import { SubjectHome } from "./pages/subject.tsx";
import { RunSummary, Runner } from "./run/runner.tsx";
import { RunBreak, StartList } from "./run/start.tsx";
import { summarize } from "./run/summary.ts";
import "./styles/app.css";

const { subject } = JSON.parse(document.getElementById("styleguide-data")!.textContent!) as { subject: Subject };

const LESSONS: Record<string, string> = { adios: "0001-greetings", rojo: "0002-colours" };

const demoRun = {
  subject: { ...subject, items: subject.items.map((item) => (LESSONS[item.id] ? { ...item, unlockedBy: LESSONS[item.id] } : item)) },
  drill: "vocab",
  planned: 5,
  timeUp: false,
  session: { sessionId: "01STYLEGUIDE00000000000000", duration: 94_000 },
  results: [
    { ref: "item:hola", outcome: "correct", grade: 3, duration: 1800 },
    { ref: "item:adios", outcome: "wrong", grade: 1, duration: 4200 },
    { ref: "item:gato", outcome: "correct", grade: 3, duration: 2100 },
    { ref: "item:rojo", outcome: "wrong", grade: 1, duration: 3100 },
    { ref: "item:gracias", outcome: "correct", grade: 3, duration: 2600 },
  ],
} as const;

const demoDue = dueToday(
  [
    { id: "morse-code", name: "Morse code", due: 9 },
    { id: "spanish", name: "Spanish", due: 4 },
  ].map(({ id, name, due }) => ({
    subject: { ...subject, id, name },
    due: Array.from({ length: due }, (_, index) => ({ item: subject.items[index % subject.items.length]!, due: null })),
  })),
);

const nothing = () => {};

function mount(selector: string, page: ReactNode, path = "/") {
  for (const element of document.querySelectorAll(selector)) {
    createRoot(element).render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
      </StrictMode>,
    );
  }
}

mount("[data-styleguide-home]", <Home />);
for (const tab of ["overview", "curriculum", "drills", "reference", "stats"]) {
  mount(
    `[data-styleguide-subject="${tab}"]`,
    <Routes>
      <Route path="/s/:subject/:tab?" element={<SubjectHome />} />
    </Routes>,
    tab === "overview" ? "/s/morse-code" : `/s/morse-code/${tab}`,
  );
}
mount("[data-styleguide-settings]", <Settings reloadForThemeScripts={false} />);
mount("[data-styleguide-runner]", <Runner subject={subject} drill="vocab" ownsPage={false} />);
mount(
  "[data-styleguide-summary]",
  <div className="tome-runner" data-state="done">
    <RunSummary summary={summarize([{ ...demoRun, results: [...demoRun.results] }])} />
  </div>,
);
mount(
  "[data-styleguide-break]",
  <RunBreak run={{ ...demoRun, results: [...demoRun.results] }} next={demoDue.rows[0]!} onContinue={nothing} onSkip={nothing} onDone={nothing} />,
);
mount("[data-styleguide-start-list]", <StartList due={demoDue} />);
