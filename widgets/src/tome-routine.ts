import { html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { Item } from "@tomewise/core";
import { type Grade, tome } from "./api.ts";
import { adoptStyles, messageOf, TomeElement } from "./element.ts";
import { GRADES, gradeKey, labelOf, outcomeOf } from "./rating.ts";
import "./tome-timer.ts";

type Routine = Extract<Item, { type: "routine" }>;
type State = "loading" | "error" | "ready" | "step" | "rate" | "saving" | "saved";

const CSS = `
.tome-routine { display: flex; flex-direction: column; gap: .8rem; padding: 1rem; background: var(--t-surface); color: var(--t-ink); border: 1px solid var(--t-rule); border-radius: var(--t-radius); font-family: var(--t-ui); }
.tome-routine .tome-routine-name { margin: 0; font-family: var(--t-display); font-size: 1.2rem; }
.tome-routine .tome-progress { margin: 0; color: var(--t-muted); font-size: .85rem; }
.tome-routine .tome-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .8rem; text-align: center; min-height: 6rem; }
.tome-routine .tome-step { margin: 0; font-family: var(--t-display); font-size: 1.5rem; }
.tome-routine :is(.tome-start, .tome-next, .tome-grade) { font: inherit; padding: .6rem .9rem; min-height: 2.75rem; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); cursor: pointer; touch-action: manipulation; }
.tome-routine :is(.tome-start, .tome-next) { align-self: center; background: var(--t-accent); color: var(--t-accent-ink); border-color: var(--t-accent); }
.tome-routine .tome-grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; }
.tome-routine .tome-grade kbd { display: block; font-family: var(--t-mono); font-size: .7rem; color: var(--t-muted); }
.tome-routine .tome-grade:disabled { cursor: default; }
.tome-routine .tome-grade[data-state="chosen"] { border-color: var(--t-accent); color: var(--t-accent); }
.tome-routine :is(.tome-start, .tome-next, .tome-grade):focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-routine .tome-verdict { margin: 0; align-self: center; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; }
.tome-routine .tome-verdict[data-state="correct"] { color: var(--t-good); background: var(--t-good-bg); }
.tome-routine .tome-verdict[data-state="wrong"] { color: var(--t-bad); background: var(--t-bad-bg); }
.tome-routine .tome-hint { margin: 0; color: var(--t-muted); font-size: .85rem; }
`;

export class TomeRoutine extends TomeElement {
  static override properties = {
    ref: { type: String },
    state: { state: true },
    item: { state: true },
    step: { state: true },
    notice: { state: true },
    chosen: { state: true },
  };

  declare ref: string;
  declare state: State;
  declare item: Routine | undefined;
  declare step: number;
  declare notice: string | undefined;
  declare chosen: Grade | undefined;

  #startedAt = 0;
  #duration = 0;

  constructor() {
    super();
    this.ref = "";
    this.state = "loading";
    this.step = 0;
    this.addEventListener("keydown", (event) => this.#onKey(event));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-routine", CSS);
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
      if (item.type !== "routine") throw new Error(`"${ref}" is a ${item.type} item, not a routine.`);
      this.item = item;
      this.step = 0;
      this.state = "ready";
    } catch (error) {
      if (ref !== this.ref) return;
      this.state = "error";
      this.notice = messageOf(error);
    }
  }

  #start(): void {
    if (this.state !== "ready") return;
    this.#startedAt = performance.now();
    this.step = 0;
    this.state = "step";
    this.#focus(".tome-next");
  }

  #next(): void {
    if (this.state !== "step" || !this.item) return;
    if (this.step < this.item.steps.length - 1) {
      this.step += 1;
      return;
    }
    this.#duration = performance.now() - this.#startedAt;
    this.state = "rate";
    this.#focus('.tome-grade[data-grade="3"]');
  }

  async #rate(grade: Grade): Promise<void> {
    if (this.state !== "rate" || !this.item) return;
    this.state = "saving";
    this.chosen = grade;
    this.notice = undefined;
    try {
      await tome.attempt({ ref: `item:${this.item.id}`, outcome: outcomeOf(grade), grade, duration: this.#duration });
      this.state = "saved";
    } catch (error) {
      this.state = "rate";
      this.chosen = undefined;
      this.notice = messageOf(error);
    }
  }

  #focus(selector: string): void {
    void this.updateComplete.then(() => this.querySelector<HTMLElement>(selector)?.focus());
  }

  #onKey(event: KeyboardEvent): void {
    if (this.state === "step" && event.key === "ArrowRight" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.#next();
      return;
    }
    const grade = gradeKey(event);
    if (this.state === "rate" && grade) {
      event.preventDefault();
      void this.#rate(grade);
    }
  }

  protected override render() {
    const notice = this.notice ? html`<p class="tome-notice" role="alert">${this.notice}</p>` : nothing;
    if (this.state === "loading") {
      return html`<div class="tome-routine" data-state="loading"><p class="tome-hint">Loading…</p></div>`;
    }
    if (this.state === "error" || !this.item) {
      return html`<div class="tome-routine" data-state="error">${notice}</div>`;
    }
    const { name, steps } = this.item;
    return html`
      <div class="tome-routine" data-state=${this.state} aria-busy=${this.state === "saving" ? "true" : "false"}>
        <p class="tome-routine-name">${name}</p>
        ${this.#body(steps)} ${notice}
      </div>
    `;
  }

  #body(steps: Routine["steps"]) {
    if (this.state === "ready") {
      return html`<p class="tome-progress">${steps.length === 1 ? "1 step" : `${steps.length} steps`}</p>
        <button type="button" class="tome-start" @click=${() => this.#start()}>Start</button>`;
    }
    if (this.state === "step") {
      const step = steps[this.step]!;
      const last = this.step === steps.length - 1;
      return html`<p class="tome-progress">Step ${this.step + 1} of ${steps.length}</p>
        <div class="tome-stage" aria-live="polite">
          <p class="tome-step">${step.text}</p>
          ${step.seconds
            ? keyed(this.step, html`<tome-timer seconds=${String(step.seconds)} autostart></tome-timer>`)
            : nothing}
        </div>
        <button type="button" class="tome-next" @click=${() => this.#next()}>${last ? "Finish" : "Next"}</button>`;
    }
    const done = this.state === "saving" || this.state === "saved";
    return html`<p class="tome-progress">How did it go?</p>
      <div class="tome-grades" role="group" aria-label="How did it go?">
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
      </div>
      ${this.state === "saved"
        ? html`<p class="tome-verdict" role="status" data-state=${outcomeOf(this.chosen!)}>
            Saved: ${labelOf(this.chosen)}
          </p>`
        : nothing}`;
  }
}

customElements.define("tome-routine", TomeRoutine);

declare global {
  interface HTMLElementTagNameMap {
    "tome-routine": TomeRoutine;
  }
}
