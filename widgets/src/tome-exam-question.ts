import { html, nothing, type PropertyValues } from "lit";
import type { Answer, AnswerElement } from "./answer.ts";
import { tome } from "./api.ts";
import { adoptStyles, messageOf, TomeElement } from "./element.ts";

export type QuestionState = "loading" | "error" | "ready" | "answered";

const CONTROLS = "tome-choice, tome-typed";

const CSS = `
.tome-exam-question { display: flex; flex-direction: column; gap: .8rem; padding: 1rem; background: var(--t-surface); color: var(--t-ink); border: 1px solid var(--t-rule); border-radius: var(--t-radius); font-family: var(--t-ui); }
.tome-exam-question .tome-question { display: flex; flex-direction: column; gap: .8rem; }
.tome-exam-question .tome-question > * { margin: 0; }
.tome-exam-question :is(.tome-choice, .tome-typed) { padding: 0; background: transparent; border: 0; }
.tome-exam-question[data-state="error"] .tome-question { opacity: .45; }
`;

export class TomeExamQuestion extends TomeElement {
  static override properties = {
    tests: { type: String },
    state: { state: true },
    notice: { state: true },
  };

  declare tests: string;
  declare state: QuestionState;
  declare notice: string | undefined;

  #content: Node[] | undefined;
  #control: AnswerElement<never> | null = null;
  #refs: string[] = [];
  #answer: Answer | undefined;
  #saved = new Set<string>();

  constructor() {
    super();
    this.tests = "";
    this.state = "loading";
    this.addEventListener("tome-answered", () => {
      if (this.state === "ready") this.state = "answered";
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-exam-question", CSS);
    if (this.#content) return;
    this.#control = this.querySelector<AnswerElement<never>>(CONTROLS);
    this.#control?.setAttribute("inert", "");
    this.#content = [...this.childNodes];
    this.replaceChildren();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("tests")) void this.#check();
  }

  async #check(): Promise<void> {
    const tests = this.tests;
    const refs = [...new Set(tests.split(/\s+/).filter(Boolean))];
    this.state = "loading";
    this.notice = undefined;
    const problems: string[] = [];
    if (!this.id) problems.push('This exam question needs an id, such as id="q1", so its attempts can name it.');
    if (refs.length === 0) problems.push('Name the items this question tests, such as tests="item:letter-k item:letter-r".');
    if (!this.#control) problems.push("Put a <tome-choice> or <tome-typed> with an answer inside this exam question.");
    const found = await Promise.allSettled(refs.map((ref) => tome.item(ref)));
    if (tests !== this.tests) return;
    for (const result of found) if (result.status === "rejected") problems.push(messageOf(result.reason));
    if (problems.length > 0 || !this.#control) {
      this.state = "error";
      this.notice = problems.join(" ");
      return;
    }
    this.#refs = refs;
    this.#control.recorder = (answer) => this.#record(answer);
    this.#control.removeAttribute("inert");
    this.state = "ready";
  }

  async #record(answer: Answer): Promise<void> {
    if (answer !== this.#answer) {
      this.#answer = answer;
      this.#saved.clear();
    }
    const { outcome, grade, duration } = answer;
    for (const ref of this.#refs) {
      if (this.#saved.has(ref)) continue;
      await tome.attempt({ ref, outcome, grade, duration, data: { question: this.id } });
      this.#saved.add(ref);
    }
  }

  protected override render() {
    return html`<div class="tome-exam-question" data-state=${this.state}>
      <div class="tome-question">${this.#content}</div>
      ${this.notice ? html`<p class="tome-notice" role="alert">${this.notice}</p>` : nothing}
    </div>`;
  }
}

customElements.define("tome-exam-question", TomeExamQuestion);

declare global {
  interface HTMLElementTagNameMap {
    "tome-exam-question": TomeExamQuestion;
  }
}
