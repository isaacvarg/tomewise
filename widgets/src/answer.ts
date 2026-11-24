import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import type { Item } from "@tomewise/core";
import { type Grade, type Outcome, tome } from "./api.ts";
import { adoptStyles, messageOf, TomeElement } from "./element.ts";
import { showUnsaved } from "./notice.ts";
import { dataOrNothing, type Payload, parsePayload } from "./payload.ts";

export type AnswerState = "loading" | "error" | "ready" | "saving" | "failed" | "saved";

export type Recorder = (answer: Answer, data: Payload) => Promise<unknown>;

export interface Recordable extends HTMLElement {
  recorder: Recorder | undefined;
}

export interface Answer {
  ref: string;
  outcome: Outcome;
  grade: Grade;
  duration: number;
  given?: string;
}

type Prompted = Extract<Item, { prompt: string; answer: string }>;

export function gradeOf(outcome: Outcome): Grade {
  return outcome === "correct" ? 3 : 1;
}

export function normalizeAnswer(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function matchesAnswer(item: { answer: string; accept?: string[] }, given: string): boolean {
  const wanted = normalizeAnswer(given);
  return [item.answer, ...(item.accept ?? [])].some((candidate) => normalizeAnswer(candidate) === wanted);
}

const CSS = `
:is(.tome-choice, .tome-typed) { display: flex; flex-direction: column; gap: .8rem; padding: 1rem; background: var(--t-surface); color: var(--t-ink); border: 1px solid var(--t-rule); border-radius: var(--t-radius); font-family: var(--t-ui); }
:is(.tome-choice, .tome-typed) .tome-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 4rem; }
:is(.tome-choice, .tome-typed) .tome-prompt { margin: 0; font-family: var(--t-display); font-size: 1.4rem; }
:is(.tome-choice, .tome-typed) :is(.tome-answer, .tome-submit, .tome-skip, .tome-retry) { font: inherit; padding: .6rem .9rem; min-height: 2.75rem; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); cursor: pointer; touch-action: manipulation; }
:is(.tome-choice, .tome-typed) :is(.tome-answer, .tome-submit, .tome-skip, .tome-retry, .tome-input):focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
:is(.tome-choice, .tome-typed) :is(.tome-submit, .tome-retry) { background: var(--t-accent); color: var(--t-accent-ink); border-color: var(--t-accent); }
:is(.tome-choice, .tome-typed) :is(.tome-answer, .tome-submit):disabled { cursor: default; }
:is(.tome-choice, .tome-typed) .tome-skip { align-self: flex-end; background: transparent; border-color: transparent; color: var(--t-muted); }
:is(.tome-choice, .tome-typed) .tome-retry { align-self: center; }
.tome-choice .tome-answers { display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); gap: .5rem; }
.tome-choice .tome-answer kbd { display: block; font-family: var(--t-mono); font-size: .7rem; color: var(--t-muted); }
.tome-choice .tome-answer[data-state="correct"] { background: var(--t-good-bg); border-color: var(--t-good); color: var(--t-good); }
.tome-choice .tome-answer[data-state="wrong"] { background: var(--t-bad-bg); border-color: var(--t-bad); color: var(--t-bad); }
.tome-choice .tome-answer[data-state="faded"] { opacity: .45; }
.tome-typed .tome-entry { display: flex; gap: .5rem; }
.tome-typed .tome-input { flex: 1; min-width: 0; font: inherit; font-size: 1rem; padding: .6rem .8rem; min-height: 2.75rem; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); }
.tome-typed .tome-input[data-state="correct"] { border-color: var(--t-good); color: var(--t-good); }
.tome-typed .tome-input[data-state="wrong"] { border-color: var(--t-bad); color: var(--t-bad); }
:is(.tome-choice, .tome-typed) .tome-feedback { display: flex; justify-content: center; }
:is(.tome-choice, .tome-typed) .tome-verdict { margin: 0; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; }
:is(.tome-choice, .tome-typed) .tome-verdict[data-state="correct"] { color: var(--t-good); background: var(--t-good-bg); }
:is(.tome-choice, .tome-typed) .tome-verdict[data-state="wrong"] { color: var(--t-bad); background: var(--t-bad-bg); }
:is(.tome-choice, .tome-typed) .tome-verdict[data-state="skipped"] { color: var(--t-muted); background: var(--t-bg); }
:is(.tome-choice, .tome-typed) .tome-hint { margin: 0; color: var(--t-muted); font-size: .85rem; }
`;

export abstract class AnswerElement<T extends Prompted> extends TomeElement {
  static override properties = {
    ref: { type: String },
    payload: { type: String },
    timeLimit: { type: Number, attribute: "time-limit" },
    state: { state: true },
    item: { state: true },
    notice: { state: true },
    result: { state: true },
  };

  declare ref: string;
  declare payload: string | undefined;
  declare timeLimit: number | undefined;
  declare state: AnswerState;
  declare item: T | undefined;
  declare notice: string | undefined;
  declare result: Answer | undefined;
  declare recorder: Recorder | undefined;

  protected abstract readonly block: string;
  protected abstract readonly itemType: T["type"];
  protected abstract readonly itemLabel: string;

  #shownAt: number | undefined;
  #observer: IntersectionObserver | undefined;
  #limit: ReturnType<typeof setTimeout> | undefined;
  #inline: T | undefined;
  #extra: Payload = {};
  #read = false;

  constructor() {
    super();
    this.ref = "";
    this.state = "loading";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-answer", CSS);
    if (!this.#read) {
      this.#read = true;
      const options = [...this.querySelectorAll(":scope > option")].map((option) => option.textContent?.trim() ?? "");
      this.querySelectorAll(":scope > option").forEach((option) => option.remove());
      const answer = this.getAttribute("answer");
      if (answer !== null) this.#inline = this.inlineItem(answer, options);
    }
    this.#observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.#shownAt ??= performance.now();
      this.#observer?.disconnect();
      this.#arm();
    });
    this.#observer.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer?.disconnect();
    clearTimeout(this.#limit);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("ref") || changed.has("payload")) void this.#load();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("state") || changed.has("timeLimit")) this.#arm();
  }

  #arm(): void {
    clearTimeout(this.#limit);
    this.#limit = undefined;
    if (this.state !== "ready" || this.#shownAt === undefined || !this.timeLimit) return;
    const left = this.timeLimit * 1000 - (performance.now() - this.#shownAt);
    this.#limit = setTimeout(() => this.answer("skipped"), Math.max(0, left));
  }

  protected answer(outcome: Outcome, given?: string): void {
    if (this.state !== "ready" || !this.item) return;
    this.result = {
      ref: this.item.id ? `item:${this.item.id}` : "",
      outcome,
      grade: gradeOf(outcome),
      duration: performance.now() - (this.#shownAt ?? performance.now()),
      ...(given !== undefined && { given }),
    };
    void this.#save();
  }

  protected record(answer: Answer): Promise<unknown> {
    if (this.recorder) return this.recorder(answer, this.#extra);
    const { ref, outcome, grade, duration } = answer;
    if (!ref) {
      const message = "An answer written in the page is only recorded inside <tome-exam-question>.";
      showUnsaved(this, message);
      return Promise.reject(new Error(message));
    }
    return tome.attempt({ ref, outcome, grade, duration, ...dataOrNothing(this.#extra) }, this);
  }

  protected abstract inlineItem(answer: string, options: string[]): T;

  protected abstract renderControl(item: T): TemplateResult;

  async #load(): Promise<void> {
    const ref = this.ref;
    this.state = "loading";
    this.notice = undefined;
    this.result = undefined;
    try {
      this.#extra = parsePayload(this.payload);
      if (!ref && this.#inline) {
        this.item = this.#inline;
        this.state = "ready";
        return;
      }
      const item = await tome.item(ref);
      if (ref !== this.ref) return;
      if (item.type !== this.itemType) throw new Error(`"${ref}" is a ${item.type} item, not ${this.itemLabel}.`);
      this.item = item as T;
      this.state = "ready";
    } catch (error) {
      if (ref !== this.ref) return;
      this.state = "error";
      this.notice = messageOf(error);
    }
  }

  async #save(): Promise<void> {
    const result = this.result;
    if (!result) return;
    this.state = "saving";
    this.notice = undefined;
    try {
      await this.record(result);
      this.state = "saved";
      this.dispatchEvent(
        new CustomEvent("tome-answered", {
          bubbles: true,
          composed: true,
          detail: {
            ref: result.ref,
            outcome: result.outcome,
            grade: result.grade,
            duration: Math.round(result.duration),
            ...(result.given !== undefined && { given: result.given }),
          },
        }),
      );
    } catch {
      this.state = "failed";
      void this.updateComplete.then(() => this.querySelector<HTMLButtonElement>(".tome-retry")?.focus());
    }
  }

  #verdict(item: T, result: Answer): TemplateResult {
    const text =
      result.outcome === "correct"
        ? "Right"
        : `${result.outcome === "skipped" ? "Skipped" : "Not quite"} · the answer is ${item.answer}`;
    return html`<p class="tome-verdict" data-state=${result.outcome}>${text}</p>`;
  }

  protected override render() {
    const notice = this.notice ? html`<p class="tome-notice" role="alert">${this.notice}</p>` : nothing;
    if (this.state === "loading") {
      return html`<div class=${this.block} data-state="loading"><p class="tome-hint">Loading…</p></div>`;
    }
    if (this.state === "error" || !this.item) {
      return html`<div class=${this.block} data-state="error">${notice}</div>`;
    }
    return html`
      <div class=${this.block} data-state=${this.state} aria-busy=${this.state === "saving" ? "true" : "false"}>
        ${this.item.prompt ? html`<div class="tome-stage"><p class="tome-prompt">${this.item.prompt}</p></div>` : nothing}
        ${this.renderControl(this.item)}
        ${this.state === "ready"
          ? html`<button type="button" class="tome-skip" @click=${() => this.answer("skipped")}>Skip</button>`
          : nothing}
        <div class="tome-feedback" aria-live="polite">${this.result ? this.#verdict(this.item, this.result) : nothing}</div>
        ${this.state === "failed"
          ? html`<button type="button" class="tome-retry" @click=${() => this.#save()}>Save again</button>`
          : nothing}
        ${notice}
      </div>
    `;
  }
}
