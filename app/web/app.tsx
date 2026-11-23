import { Route, Routes } from "react-router";
import { Glossary } from "./pages/glossary.tsx";
import { Home } from "./home/home.tsx";
import { NotFound } from "./pages/not-found.tsx";
import { RunDrill, RunDue, RunQuiz } from "./pages/run.tsx";
import { Settings } from "./pages/settings.tsx";
import { SubjectHome } from "./pages/subject.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/s/:subject/glossary" element={<Glossary />} />
      <Route path="/s/:subject/:tab?" element={<SubjectHome />} />
      <Route path="/run/due" element={<RunDue />} />
      <Route path="/run/quiz" element={<RunQuiz />} />
      <Route path="/run" element={<RunDrill />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
