import { Link } from "react-router";
import type { Subject } from "./api.ts";
import { count, quizPath } from "./home/model.ts";

export function DueQuiz({ subject }: { subject: Subject }) {
  return (
    <Link className="tome-due-quiz" to={quizPath(subject.id)}>
      <span className="tome-due-what">{subject.name} quiz</span>
      <span className="tome-due-how">up to {count(subject.settings.assessments.quizLength, "question")}</span>
    </Link>
  );
}
