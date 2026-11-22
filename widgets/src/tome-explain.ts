import { html } from "lit";
import { tome } from "./api.ts";
import { adoptStyles, TomeElement } from "./element.ts";

type State = "editing" | "saving" | "saved";

const CSS = `
.tome-explain { display: flex; flex-direction: column; gap: .6rem; padding: 1rem; background: var(--t-surface); color: var(--t-ink); border: 1px solid var(--t-rule); border-radius: var(--t-radius); font-family: var(--t-ui); }
.tome-explain .tome-prompt { font-family: var(--t-display); font-size: 1.1rem; }
.tome-explain .tome-explain-text { font: inherit; min-height: 7rem; padding: .6rem .8rem; resize: vertical; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); }
.tome-explain .tome-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }
.tome-explain .tome-save { font: inherit; padding: .6rem .9rem; min-height: 2.75rem; border: 1px solid var(--t-accent); border-radius: var(--t-radius); background: var(--t-accent); color: var(--t-accent-ink); cursor: pointer; touch-action: manipulation; }
.tome-explain .tome-save:disabled { cursor: default; background: var(--t-bg); color: var(--t-muted); border-color: var(--t-rule); }
.tome-explain :is(.tome-explain-text, .tome-save):focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-explain .tome-hint { margin: 0; color: var(--t-muted); font-size: .85rem; }
.tome-explain .tome-hint kbd { font-family: var(--t-mono); }
.tome-explain .tome-verdict { margin: 0; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; color: var(--t-good); background: var(--t-good-bg); }
`;

let ids = 0;

export class TomeExplain extends TomeElement {
  static override properties = {
    ref: { type: String },
    prompt: { type: String },
    text: { state: true },
    state: { state: true },
  };

  declare ref: string;
  declare prompt: string;
  declare text: string;
  declare state: State;

  readonly #id = `tome-explain-${++ids}`;

  constructor() {
    super();
    this.ref = "";
    this.prompt = "Explain it in your own words.";
    this.text = "";
    this.state = "editing";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-explain", CSS);
  }

  get #canSave(): boolean {
    return this.state === "editing" && this.text.trim() !== "";
  }

  #onInput(event: InputEvent): void {
    this.text = (event.target as HTMLTextAreaElement).value;
    if (this.state === "saved") this.state = "editing";
  }

  #onKey(event: KeyboardEvent): void {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.#save();
    }
  }

  async #save(): Promise<void> {
    if (!this.#canSave) return;
    this.state = "saving";
    try {
      await tome.explain(this.text, this.ref, this);
      this.state = "saved";
    } catch {
      this.state = "editing";
    }
  }

  protected override render() {
    return html`
      <div class="tome-explain" data-state=${this.state} aria-busy=${this.state === "saving" ? "true" : "false"}>
        <label class="tome-prompt" for=${this.#id}>${this.prompt}</label>
        <textarea
          id=${this.#id}
          class="tome-explain-text"
          .value=${this.text}
          ?readonly=${this.state === "saving"}
          @input=${(event: InputEvent) => this.#onInput(event)}
          @keydown=${(event: KeyboardEvent) => this.#onKey(event)}
        ></textarea>
        <div class="tome-actions">
          <button type="button" class="tome-save" ?disabled=${!this.#canSave} @click=${() => this.#save()}>
            Save explanation
          </button>
          ${this.state === "saved"
            ? html`<p class="tome-verdict" role="status">Saved for grading</p>`
            : html`<p class="tome-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves</p>`}
        </div>
      </div>
    `;
  }
}

customElements.define("tome-explain", TomeExplain);

declare global {
  interface HTMLElementTagNameMap {
    "tome-explain": TomeExplain;
  }
}
