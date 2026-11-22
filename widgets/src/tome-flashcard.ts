import { html, nothing, type PropertyValues } from "lit";
import type { Item } from "@tomewise/core";
import { type Grade, tome } from "./api.ts";
import { adoptStyles, messageOf, TomeElement } from "./element.ts";

type Flashcard = Extract<Item, { type: "flashcard" }>;
type State = "loading" | "error" | "front" | "back" | "saving" | "saved";

const GRADES: { grade: Grade; label: string }[] = [
  { grade: 1, label: "Again" },
  { grade: 2, label: "Hard" },
  { grade: 3, label: "Good" },
  { grade: 4, label: "Easy" },
];

const CSS = `
.tome-flashcard { display: flex; flex-direction: column; gap: .8rem; padding: 1rem; background: var(--t-surface); color: var(--t-ink); border: 1px solid var(--t-rule); border-radius: var(--t-radius); font-family: var(--t-ui); }
.tome-flashcard .tome-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .6rem; text-align: center; min-height: 6rem; }
.tome-flashcard .tome-front, .tome-flashcard .tome-back { margin: 0; font-family: var(--t-display); font-size: 1.5rem; }
.tome-flashcard .tome-back { padding-top: .6rem; border-top: 1px solid var(--t-rule); }
.tome-flashcard .tome-reveal, .tome-flashcard .tome-grade { font: inherit; padding: .6rem .9rem; min-height: 2.75rem; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); cursor: pointer; touch-action: manipulation; }
.tome-flashcard .tome-reveal { align-self: center; background: var(--t-accent); color: var(--t-accent-ink); border-color: var(--t-accent); }
.tome-flashcard .tome-grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; }
.tome-flashcard .tome-grade kbd { display: block; font-family: var(--t-mono); font-size: .7rem; color: var(--t-muted); }
.tome-flashcard .tome-grade:disabled { cursor: default; }
.tome-flashcard .tome-grade[data-state="chosen"] { border-color: var(--t-accent); color: var(--t-accent); }
.tome-flashcard :is(.tome-reveal, .tome-grade):focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-flashcard .tome-verdict { margin: 0; align-self: center; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; }
.tome-flashcard .tome-verdict[data-state="correct"] { color: var(--t-good); background: var(--t-good-bg); }
.tome-flashcard .tome-verdict[data-state="wrong"] { color: var(--t-bad); background: var(--t-bad-bg); }
.tome-flashcard .tome-hint { margin: 0; color: var(--t-muted); font-size: .85rem; }
`;

export class TomeFlashcard extends TomeElement {
  static override properties = {
    ref: { type: String },
    state: { state: true },
    item: { state: true },
    notice: { state: true },
    chosen: { state: true },
  };

  declare ref: string;
  declare state: State;
  declare item: Flashcard | undefined;
  declare notice: string | undefined;
  declare chosen: Grade | undefined;

  #shownAt: number | undefined;
  #observer: IntersectionObserver | undefined;

  constructor() {
    super();
    this.ref = "";
    this.state = "loading";
    this.addEventListener("keydown", (event) => this.#onKey(event));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-flashcard", CSS);
    this.#observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.#shownAt ??= performance.now();
      this.#observer?.disconnect();
    });
    this.#observer.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer?.disconnect();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("ref")) void this.#load();
  }

  async #load(): Promise<void> {
    const ref = this.ref;
    this.state = "loading";
    this.notice = undefined;
    try {
      const item = await tome.item(ref);
      if (ref !== this.ref) return;
      if (item.type !== "flashcard") throw new Error(`"${ref}" is a ${item.type} item, not a flashcard.`);
      this.item = item;
      this.state = "front";
    } catch (error) {
      if (ref !== this.ref) return;
      this.state = "error";
      this.notice = messageOf(error);
    }
  }

  #reveal(): void {
    if (this.state !== "front") return;
    this.state = "back";
    void this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.tome-grade[data-grade="3"]')?.focus());
  }

  async #rate(grade: Grade): Promise<void> {
    if (this.state !== "back" || !this.item) return;
    const duration = performance.now() - (this.#shownAt ?? performance.now());
    this.state = "saving";
    this.chosen = grade;
    this.notice = undefined;
    try {
      await tome.attempt({ ref: `item:${this.item.id}`, outcome: grade === 1 ? "wrong" : "correct", grade, duration });
      this.state = "saved";
    } catch (error) {
      this.state = "back";
      this.chosen = undefined;
      this.notice = messageOf(error);
    }
  }

  #onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const grade = Number(event.key);
    if (this.state === "back" && grade >= 1 && grade <= 4) {
      event.preventDefault();
      void this.#rate(grade as Grade);
    }
  }

  protected override render() {
    const notice = this.notice ? html`<p class="tome-notice" role="alert">${this.notice}</p>` : nothing;
    if (this.state === "loading") {
      return html`<div class="tome-flashcard" data-state="loading"><p class="tome-hint">Loading…</p></div>`;
    }
    if (this.state === "error" || !this.item) {
      return html`<div class="tome-flashcard" data-state="error">${notice}</div>`;
    }
    const revealed = this.state !== "front";
    const done = this.state === "saving" || this.state === "saved";
    return html`
      <div class="tome-flashcard" data-state=${this.state} aria-busy=${this.state === "saving" ? "true" : "false"}>
        <div class="tome-stage">
          <p class="tome-front">${this.item.front}</p>
          ${revealed ? html`<p class="tome-back">${this.item.back}</p>` : nothing}
        </div>
        ${revealed
          ? html`<div class="tome-grades" role="group" aria-label="How well did you know it?">
              ${GRADES.map(
                ({ grade, label }) => html`<button
                  type="button"
                  class="tome-grade"
                  data-grade=${grade}
                  data-state=${this.chosen === grade ? "chosen" : nothing}
                  ?disabled=${done}
                  @click=${() => this.#rate(grade)}
                >
                  ${label}<kbd>${grade}</kbd>
                </button>`,
              )}
            </div>`
          : html`<button type="button" class="tome-reveal" @click=${() => this.#reveal()}>Show answer</button>`}
        ${this.state === "saved"
          ? html`<p class="tome-verdict" role="status" data-state=${this.chosen === 1 ? "wrong" : "correct"}>
              Saved: ${GRADES.find(({ grade }) => grade === this.chosen)?.label}
            </p>`
          : nothing}
        ${notice}
      </div>
    `;
  }
}

customElements.define("tome-flashcard", TomeFlashcard);

declare global {
  interface HTMLElementTagNameMap {
    "tome-flashcard": TomeFlashcard;
  }
}
