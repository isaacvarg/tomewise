import { Link } from "react-router";
import type { QuizSlot, Subject } from "./api.ts";
import { count, quizPath, writtenQuizPath } from "./home/model.ts";

export function DueQuiz({ subject, quiz }: { subject: Subject; quiz: QuizSlot }) {
  const what = <span className="tome-due-what">{subject.name} quiz</span>;
  if (quiz.quiz !== undefined) {
    return (
      <a className="tome-due-quiz" href={writtenQuizPath(subject.id, quiz.quiz)}>
        {what}
        <span className="tome-due-how">written by your agent</span>
      </a>
    );
  }
  return (
    <Link className="tome-due-quiz" to={quizPath(subject.id)}>
      {what}
      <span className="tome-due-how">up to {count(subject.settings.assessments.quizLength, "question")}</span>
    </Link>
  );
}
