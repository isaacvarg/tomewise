import { html, nothing } from "lit";
import { tome } from "./api.ts";
import { adoptStyles, TomeElement } from "./element.ts";

type State = "ready" | "saving" | "done";

const CSS = `
.tome-done { display: flex; flex-wrap: wrap; align-items: center; gap: .8rem; font-family: var(--t-ui); color: var(--t-ink); }
.tome-done .tome-done-button { font: inherit; font-weight: 600; padding: .6rem 1.4rem; min-height: 2.75rem; border: 1px solid var(--t-accent); border-radius: var(--t-radius); background: var(--t-accent); color: var(--t-accent-ink); cursor: pointer; touch-action: manipulation; }
.tome-done .tome-done-button:disabled { cursor: default; background: var(--t-surface); color: var(--t-muted); border-color: var(--t-rule); }
.tome-done .tome-done-button:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-done .tome-verdict { margin: 0; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; color: var(--t-good); background: var(--t-good-bg); }
`;

export class TomeDone extends TomeElement {
  static override properties = {
    label: { type: String },
    state: { state: true },
  };

  declare label: string;
  declare state: State;

  constructor() {
    super();
    this.label = "Done";
    this.state = "ready";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-done", CSS);
  }

  async #complete(): Promise<void> {
    if (this.state !== "ready") return;
    this.state = "saving";
    try {
      await tome.complete(this);
      this.state = "done";
    } catch {
      this.state = "ready";
    }
  }

  protected override render() {
    return html`
      <div class="tome-done" data-state=${this.state} aria-busy=${this.state === "saving" ? "true" : "false"}>
        <button type="button" class="tome-done-button" ?disabled=${this.state !== "ready"} @click=${() => this.#complete()}>
          ${this.label}
        </button>
        ${this.state === "done" ? html`<p class="tome-verdict" role="status">Lesson complete</p>` : nothing}
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
