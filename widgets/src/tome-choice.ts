import { html, nothing } from "lit";
import type { Item } from "@tomewise/core";
import { AnswerElement } from "./answer.ts";

type MultipleChoice = Extract<Item, { type: "multiple-choice" }>;

export class TomeChoice extends AnswerElement<MultipleChoice> {
  protected readonly block = "tome-choice";
  protected readonly itemType = "multiple-choice";
  protected readonly itemLabel = "multiple choice";

  constructor() {
    super();
    this.addEventListener("keydown", (event) => this.#onKey(event));
  }

  protected inlineItem(answer: string, choices: string[]): MultipleChoice {
    return { id: "", type: "multiple-choice", prompt: "", choices, answer, tags: [], retired: false };
  }

  choose(choice: string): void {
    if (!this.item) return;
    this.answer(choice === this.item.answer ? "correct" : "wrong", choice);
  }

  #onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || this.state !== "ready" || !this.item) return;
    if (!/^[1-9]$/.test(event.key)) return;
    const choice = this.item.choices[Number(event.key) - 1];
    if (choice === undefined) return;
    event.preventDefault();
    this.choose(choice);
  }

  #stateOf(choice: string): string | typeof nothing {
    if (!this.result || !this.item) return nothing;
    if (choice === this.item.answer) return "correct";
    return choice === this.result.given ? "wrong" : "faded";
  }

  protected renderControl(item: MultipleChoice) {
    return html`<div class="tome-answers" role="group" aria-label="Choices">
      ${item.choices.map(
        (choice, index) => html`<button
          type="button"
          class="tome-answer"
          data-state=${this.#stateOf(choice)}
          ?disabled=${this.state !== "ready"}
          @click=${() => this.choose(choice)}
        >
          ${choice}${index < 9 ? html`<kbd>${index + 1}</kbd>` : nothing}
        </button>`,
      )}
    </div>`;
  }
}

customElements.define("tome-choice", TomeChoice);

declare global {
  interface HTMLElementTagNameMap {
    "tome-choice": TomeChoice;
  }
}
