import { describe, expect, it } from "vitest";
import { stackedWidgetIssues } from "../src/lesson-checks.ts";

const FILE = "subjects/spanish/lessons/0001-greetings.html";
const card = (id: string) => `<tome-flashcard ref="item:${id}"></tome-flashcard>`;
const found = (html: string) => stackedWidgetIssues(FILE, html).map(({ line, message }) => `${line}: ${message}`);

describe("stacked item widgets in a lesson", () => {
  it("flags three or more item widgets in a row, naming the drill to write instead", () => {
    const issues = stackedWidgetIssues(FILE, `<h1>Greetings</h1>\n${card("hola")}\n${card("adios")}\n<tome-typed ref="item:gracias"></tome-typed>\n<tome-done></tome-done>`);

    expect(issues).toEqual([
      {
        file: FILE,
        line: 2,
        path: "",
        advice: true,
        message:
          '3 item widgets in a row; show them one at a time with one <tome-drill items="hola adios gracias">, or put the teaching each one belongs to between them',
      },
    ]);
  });

  it("flags an item asked more than once, wherever its widgets sit", () => {
    const html = `<p>K is dah-di-dah.</p>\n<tome-audio ref="item:letter-k" choices="K M"></tome-audio>\n<p>And again.</p>\n<tome-audio ref='item:letter-k' choices="M K"></tome-audio>`;

    expect(found(html)).toEqual(['4: item:letter-k has 2 widgets on this page; ask it once, and repeat it with <tome-drill items="letter-k" count="2">']);
  });

  it("reports a stack of one repeated item once", () => {
    const html = Array.from({ length: 12 }, (_, index) => `<tome-audio ref="item:letter-${index % 2 ? "m" : "k"}" choices="K M"></tome-audio>`).join("\n");

    expect(found(html)).toEqual([
      '1: 12 item widgets in a row; show them one at a time with one <tome-drill items="letter-k letter-m">, or put the teaching each one belongs to between them',
    ]);
  });

  it("allows widgets that each follow their own teaching, a pair, a drill, exam questions and comments", () => {
    const html = [
      `<p>hola means hello.</p>${card("hola")}<p>adiós means goodbye.</p>${card("adios")}<p>gracias means thanks.</p>${card("gracias")}`,
      `<h2>Two more</h2>${card("si")}\n${card("no")}`,
      `<tome-drill items="hola adios gracias si no" count="10"></tome-drill>`,
      `<tome-exam-question id="q1" tests="item:hola"><tome-choice answer="a"></tome-choice></tome-exam-question>`.repeat(3),
      `<!-- ${card("x")}${card("x")}${card("x")} -->`,
      `<tome-done></tome-done>`,
    ].join("\n");

    expect(found(html)).toEqual([]);
  });
});
