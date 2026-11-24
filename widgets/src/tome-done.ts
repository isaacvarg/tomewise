import { html, nothing } from "lit";
import { type ScoreView, scoreView } from "@tomewise/core/score";
import { readPageContext, tome } from "./api.ts";
import { adoptStyles, TomeElement } from "./element.ts";

type State = "ready" | "saving" | "done";

const CSS = `
.tome-done { display: flex; flex-wrap: wrap; align-items: center; gap: .8rem; font-family: var(--t-ui); color: var(--t-ink); }
.tome-done .tome-done-button { font: inherit; font-weight: 600; padding: .6rem 1.4rem; min-height: 2.75rem; border: 1px solid var(--t-accent); border-radius: var(--t-radius); background: var(--t-accent); color: var(--t-accent-ink); cursor: pointer; touch-action: manipulation; }
.tome-done .tome-done-button:disabled { cursor: default; background: var(--t-surface); color: var(--t-muted); border-color: var(--t-rule); }
.tome-done .tome-done-button:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-done .tome-verdict { margin: 0; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; color: var(--t-good); background: var(--t-good-bg); }
.tome-done .tome-exam-score { display: flex; flex-direction: column; gap: .2rem; flex-basis: 100%; }
.tome-done .tome-score { font-family: var(--t-display); font-size: 2.2rem; line-height: 1.1; }
.tome-done .tome-exam-score[data-passed="true"] .tome-score { color: var(--t-good); }
.tome-done .tome-score-sub { color: var(--t-muted); font-size: .9rem; }
`;

export class TomeDone extends TomeElement {
  static override properties = {
    label: { type: String },
    state: { state: true },
    score: { state: true },
  };

  declare label: string | undefined;
  declare state: State;
  declare score: ScoreView | undefined;

  constructor() {
    super();
    this.state = "ready";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-done", CSS);
  }

  get #scored(): "exam" | "quiz" | undefined {
    const kind = readPageContext(document)?.kind;
    return kind === "exam" || kind === "quiz" ? kind : undefined;
  }

  async #complete(): Promise<void> {
    if (this.state !== "ready") return;
    this.state = "saving";
    try {
      if (this.#scored) await this.#finish();
      else await tome.complete(this);
      this.state = "done";
    } catch {
      this.state = "ready";
    }
  }

  async #finish(): Promise<void> {
    const [{ result }, subject] = await Promise.all([tome.finish(this), tome.subject()]);
    for (const question of document.querySelectorAll("tome-exam-question")) question.setAttribute("inert", "");
    this.score = scoreView(result, subject.settings.assessments.scoreDisplay);
  }

  #verdict() {
    const score = this.score;
    if (!score) return html`<p class="tome-verdict" role="status">Lesson complete</p>`;
    return html`<div class="tome-exam-score" role="status" data-display=${score.display} data-passed=${score.passed === undefined ? nothing : String(score.passed)}>
      <p class="tome-verdict">${this.#scored === "quiz" ? "Quiz finished" : "Exam finished"}</p>
      ${score.headline ? html`<span class="tome-score">${score.headline}</span>` : nothing}
      <span class="tome-score-sub">${score.detail}</span>
    </div>`;
  }

  protected override render() {
    return html`
      <div class="tome-done" data-state=${this.state} aria-busy=${this.state === "saving" ? "true" : "false"}>
        <button type="button" class="tome-done-button" ?disabled=${this.state !== "ready"} @click=${() => this.#complete()}>
          ${this.label ?? { exam: "Finish exam", quiz: "Finish quiz", none: "Done" }[this.#scored ?? "none"]}
        </button>
        ${this.state === "done" ? this.#verdict() : nothing}
      </div>
    `;
  }
}

customElements.define("tome-done", TomeDone);

declare global {
  interface HTMLElementTagNameMap {
    "tome-done": TomeDone;
  }
}
