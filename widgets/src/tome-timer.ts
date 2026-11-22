import { html, nothing, type PropertyValues } from "lit";
import { adoptStyles, TomeElement } from "./element.ts";

type State = "idle" | "running" | "paused" | "done" | "error";

const TICK_MS = 100;

const CSS = `
.tome-timer { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .6rem; font-family: var(--t-ui); color: var(--t-ink); }
.tome-timer .tome-clock { margin: 0; min-width: 4ch; font-family: var(--t-mono); font-size: 1.6rem; font-variant-numeric: tabular-nums; text-align: center; }
.tome-timer[data-state="paused"] .tome-clock { color: var(--t-muted); }
.tome-timer[data-state="done"] .tome-clock { color: var(--t-good); }
.tome-timer .tome-timer-controls { display: flex; gap: .5rem; }
.tome-timer :is(.tome-timer-toggle, .tome-timer-reset) { font: inherit; padding: .5rem .8rem; min-height: 2.75rem; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); cursor: pointer; touch-action: manipulation; }
.tome-timer .tome-timer-toggle { background: var(--t-accent); color: var(--t-accent-ink); border-color: var(--t-accent); }
.tome-timer :is(.tome-timer-toggle, .tome-timer-reset):focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-timer .tome-verdict { margin: 0; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; color: var(--t-good); background: var(--t-good-bg); }
`;

const TOGGLE: Partial<Record<State, string>> = { idle: "Start", running: "Pause", paused: "Resume" };

export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export class TomeTimer extends TomeElement {
  static override properties = {
    seconds: { type: String },
    autostart: { type: Boolean },
    state: { state: true },
    remaining: { state: true },
  };

  declare seconds: string;
  declare autostart: boolean;
  declare state: State;
  declare remaining: number;

  #deadline = 0;
  #interval: ReturnType<typeof setInterval> | undefined;

  constructor() {
    super();
    this.seconds = "";
    this.autostart = false;
    this.state = "idle";
    this.remaining = 0;
  }

  get total(): number {
    const seconds = Number(this.seconds);
    return this.seconds.trim() !== "" && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : NaN;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-timer", CSS);
    if (this.state === "running") this.#tick();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopTicking();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("seconds")) return;
    this.reset();
    if (this.autostart) this.start();
  }

  start(): void {
    if (this.state !== "idle" && this.state !== "paused") return;
    this.#deadline = performance.now() + this.remaining;
    this.state = "running";
    this.#tick();
  }

  pause(): void {
    if (this.state !== "running") return;
    this.#stopTicking();
    this.remaining = Math.max(0, this.#deadline - performance.now());
    this.state = "paused";
  }

  reset(): void {
    this.#stopTicking();
    const total = this.total;
    this.remaining = Number.isNaN(total) ? 0 : total;
    this.state = Number.isNaN(total) ? "error" : "idle";
  }

  #tick(): void {
    this.#stopTicking();
    this.#interval = setInterval(() => this.#update(), TICK_MS);
  }

  #stopTicking(): void {
    clearInterval(this.#interval);
    this.#interval = undefined;
  }

  #update(): void {
    this.remaining = Math.max(0, this.#deadline - performance.now());
    if (this.remaining > 0) return;
    this.#stopTicking();
    this.state = "done";
    this.dispatchEvent(new CustomEvent("tome-timer-done", { bubbles: true, composed: true }));
  }

  #toggle(): void {
    if (this.state === "running") this.pause();
    else this.start();
  }

  protected override render() {
    if (this.state === "error") {
      return html`<div class="tome-timer" data-state="error">
        <p class="tome-notice" role="alert">
          A timer needs a number of seconds, such as seconds="30"; this one has seconds="${this.seconds}".
        </p>
      </div>`;
    }
    const toggle = TOGGLE[this.state];
    return html`
      <div class="tome-timer" data-state=${this.state}>
        <p class="tome-clock" role="timer" aria-label="Time left">${formatClock(this.remaining)}</p>
        <div class="tome-timer-controls">
          ${toggle
            ? html`<button type="button" class="tome-timer-toggle" @click=${() => this.#toggle()}>${toggle}</button>`
            : nothing}
          ${this.state !== "idle"
            ? html`<button type="button" class="tome-timer-reset" @click=${() => this.reset()}>Reset</button>`
            : nothing}
        </div>
        ${this.state === "done" ? html`<p class="tome-verdict" role="status">Time's up</p>` : nothing}
      </div>
    `;
  }
}

customElements.define("tome-timer", TomeTimer);

declare global {
  interface HTMLElementTagNameMap {
    "tome-timer": TomeTimer;
  }
}
