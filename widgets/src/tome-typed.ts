import { html, nothing } from "lit";
import type { Item } from "@tomewise/core";
import { AnswerElement, matchesAnswer, normalizeAnswer } from "./answer.ts";

type TypedAnswer = Extract<Item, { type: "typed-answer" }>;

export class TomeTyped extends AnswerElement<TypedAnswer> {
  protected readonly block = "tome-typed";
  protected readonly itemType = "typed-answer";
  protected readonly itemLabel = "a typed answer";

  protected inlineItem(answer: string, accept: string[]): TypedAnswer {
    return { id: "", type: "typed-answer", prompt: "", answer, accept, tags: [], retired: false };
  }

  check(given: string): void {
    if (!this.item || !normalizeAnswer(given)) return;
    this.answer(matchesAnswer(this.item, given) ? "correct" : "wrong", given);
  }

  #onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const input = this.querySelector<HTMLInputElement>(".tome-input");
    if (input) this.check(input.value);
  }

  protected renderControl() {
    const answered = this.state !== "ready";
    const verdict = this.result && this.result.outcome !== "skipped" ? this.result.outcome : nothing;
    return html`<form class="tome-entry" @submit=${(event: SubmitEvent) => this.#onSubmit(event)}>
      <input
        class="tome-input"
        type="text"
        aria-label="Your answer"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="done"
        data-state=${verdict}
        ?readonly=${answered}
      />
      <button type="submit" class="tome-submit" ?disabled=${answered}>Check</button>
    </form>`;
  }
}

customElements.define("tome-typed", TomeTyped);

declare global {
  interface HTMLElementTagNameMap {
    "tome-typed": TomeTyped;
  }
}
