import { html, nothing, type PropertyValues } from "lit";
import type { Item } from "@tomewise/core";
import { type Grade, type Outcome, tome } from "./api.ts";
import { adoptStyles, messageOf, TomeElement } from "./element.ts";

type TimedAudio = Extract<Item, { type: "timed-audio" }>;
type State = "loading" | "error" | "ready" | "listening" | "answering" | "saving" | "saved" | "unsaved";

interface Result {
  given: string;
  outcome: Outcome;
  grade: Grade;
  responseTime: number;
  replays: number;
}

const CSS = `
.tome-audio { display: flex; flex-direction: column; gap: .9rem; padding: 1rem; background: var(--t-surface); color: var(--t-ink); border: 1px solid var(--t-rule); border-radius: var(--t-radius); font-family: var(--t-ui); }
.tome-audio .tome-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .8rem; text-align: center; min-height: 10rem; }
.tome-audio .tome-play { width: 6rem; height: 6rem; border-radius: 50%; border: 2px solid var(--t-ink); background: transparent; color: var(--t-ink); display: grid; place-items: center; cursor: pointer; position: relative; touch-action: manipulation; }
.tome-audio .tome-play svg { width: 2rem; height: 2rem; margin-left: .25rem; }
.tome-audio .tome-play[data-playing]::after { content: ""; position: absolute; inset: -8px; border-radius: 50%; border: 2px solid var(--t-accent); animation: tome-audio-pulse 700ms ease-out infinite; }
@keyframes tome-audio-pulse { from { transform: scale(.92); opacity: 1; } to { transform: scale(1.12); opacity: 0; } }
.tome-audio .tome-prompt { margin: 0; font-family: var(--t-display); font-size: 1.4rem; }
.tome-audio .tome-hint { margin: 0; font-size: .85rem; color: var(--t-muted); min-height: 1.3em; }
.tome-audio .tome-hint kbd { font-family: var(--t-mono); font-size: .75rem; border: 1px solid var(--t-rule); border-radius: 4px; padding: 0 .3rem; }
.tome-audio .tome-countdown { align-self: stretch; height: 4px; background: var(--t-rule); border-radius: 99px; overflow: hidden; }
.tome-audio .tome-countdown span { display: block; height: 100%; background: var(--t-accent); transform-origin: left; animation: tome-audio-countdown linear forwards; }
@keyframes tome-audio-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.tome-audio .tome-feedback { display: flex; flex-direction: column; align-items: center; gap: .4rem; min-height: 3.5rem; }
.tome-audio .tome-say { margin: 0; font-family: var(--t-display); font-size: 1.4rem; }
.tome-audio .tome-verdict { margin: 0; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; font-variant-numeric: tabular-nums; }
.tome-audio .tome-verdict[data-state="correct"] { color: var(--t-good); background: var(--t-good-bg); }
.tome-audio .tome-verdict:is([data-state="wrong"], [data-state="skipped"]) { color: var(--t-bad); background: var(--t-bad-bg); }
.tome-audio .tome-answers { display: grid; grid-template-columns: repeat(auto-fit, minmax(3.5rem, 1fr)); gap: .5rem; }
.tome-audio .tome-answer { min-height: 3.5rem; border: 1px solid var(--t-rule); background: var(--t-bg); color: var(--t-ink); border-radius: var(--t-radius); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .2rem; cursor: pointer; font: inherit; touch-action: manipulation; }
.tome-audio .tome-answer b { font-family: var(--t-display); font-weight: 400; font-size: 1.5rem; line-height: 1; }
.tome-audio .tome-answer kbd { font-family: var(--t-mono); font-size: .65rem; color: var(--t-muted); }
.tome-audio .tome-answer:disabled { cursor: default; }
.tome-audio .tome-answer[data-state="correct"] { background: var(--t-good-bg); border-color: var(--t-good); color: var(--t-good); }
.tome-audio .tome-answer[data-state="wrong"] { background: var(--t-bad-bg); border-color: var(--t-bad); color: var(--t-bad); }
.tome-audio .tome-answer[data-state="faded"] { opacity: .45; }
.tome-audio .tome-respond { display: flex; gap: .5rem; }
.tome-audio .tome-input { flex: 1; min-width: 0; font: inherit; padding: .6rem .8rem; min-height: 2.75rem; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); }
.tome-audio :is(.tome-submit, .tome-retry) { font: inherit; padding: .6rem .9rem; min-height: 2.75rem; border: 1px solid var(--t-accent); border-radius: var(--t-radius); background: var(--t-accent); color: var(--t-accent-ink); cursor: pointer; touch-action: manipulation; }
.tome-audio .tome-retry { align-self: center; }
.tome-audio :is(.tome-play, .tome-answer, .tome-input, .tome-submit, .tome-retry):focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .tome-audio .tome-play[data-playing]::after { animation: none; } }
`;

const PLAY_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" />
</svg>`;

const normalize = (answer: string) => answer.trim().toLowerCase();

export class TomeAudio extends TomeElement {
  static override properties = {
    ref: { type: String },
    choices: { type: String },
    payload: { type: String },
    state: { state: true },
    item: { state: true },
    notice: { state: true },
    playing: { state: true },
    result: { state: true },
  };

  declare ref: string;
  declare choices: string | undefined;
  declare payload: string | undefined;
  declare state: State;
  declare item: TimedAudio | undefined;
  declare notice: string | undefined;
  declare playing: boolean;
  declare result: Result | undefined;

  #extra: Record<string, unknown> = {};
  #audio: HTMLAudioElement | undefined;
  #heardAt = 0;
  #replays = 0;
  #limit: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.ref = "";
    this.state = "loading";
    this.playing = false;
    this.addEventListener("keydown", (event) => this.#onKey(event));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-audio", CSS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stop();
  }

  get #options(): string[] {
    return (this.choices ?? "").split(/\s+/).filter(Boolean);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("ref") || changed.has("payload")) void this.#load();
  }

  #stop(): void {
    clearTimeout(this.#limit);
    this.#limit = undefined;
    this.#audio?.pause();
    this.playing = false;
  }

  async #load(): Promise<void> {
    const ref = this.ref;
    this.#stop();
    this.#audio = undefined;
    this.state = "loading";
    this.notice = undefined;
    this.result = undefined;
    this.#replays = 0;
    try {
      this.#extra = this.#parsePayload();
      const item = await tome.item(ref);
      if (ref !== this.ref) return;
      if (item.type !== "timed-audio") throw new Error(`"${ref}" is a ${item.type} item, not a timed-audio item.`);
      this.item = item;
      if (item.audio) this.#audio = new Audio(`/s/${encodeURIComponent(tome.context.subject)}/${item.audio}`);
      this.state = "ready";
    } catch (error) {
      if (ref !== this.ref) return;
      this.state = "error";
      this.notice = messageOf(error);
    }
  }

  #parsePayload(): Record<string, unknown> {
    if (!this.payload) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.payload);
    } catch {
      parsed = undefined;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`The payload attribute must be a JSON object, such as payload='{"wpm":20}'.`);
    }
    return parsed as Record<string, unknown>;
  }

  async #play(): Promise<void> {
    if (!this.item || this.state === "loading" || this.state === "error") return;
    const first = this.state === "ready";
    if (!first && (this.state === "listening" || this.state === "answering")) this.#replays++;
    if (!this.#audio) {
      if (first) this.#beginAnswering();
      return;
    }
    if (first) this.state = "listening";
    const audio = this.#audio;
    audio.currentTime = 0;
    audio.onended = () => {
      this.playing = false;
      if (this.state === "listening") this.#beginAnswering();
    };
    this.playing = true;
    try {
      await audio.play();
      this.notice = undefined;
    } catch (error) {
      this.playing = false;
      if (this.state === "listening") this.state = "ready";
      this.notice = `Couldn't play the sound: ${messageOf(error)}`;
    }
  }

  #beginAnswering(): void {
    this.state = "answering";
    this.#heardAt = performance.now();
    const seconds = this.item?.timeLimitSeconds;
    if (seconds !== undefined) this.#limit = setTimeout(() => this.#decide(undefined), seconds * 1000);
    if (this.#options.length === 0) {
      void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".tome-input")?.focus());
    }
  }

  #decide(given: string | undefined): void {
    if (this.state !== "answering" || !this.item) return;
    clearTimeout(this.#limit);
    this.#limit = undefined;
    const right = given !== undefined && normalize(given) === normalize(this.item.answer);
    this.result = {
      given: given?.trim() ?? "",
      outcome: given === undefined ? "skipped" : right ? "correct" : "wrong",
      grade: right ? 3 : 1,
      responseTime: Math.max(0, Math.round(performance.now() - this.#heardAt)),
      replays: this.#replays,
    };
    void this.#save();
  }

  async #save(): Promise<void> {
    const result = this.result;
    if (!result || !this.item) return;
    this.state = "saving";
    this.notice = undefined;
    try {
      await tome.attempt({
        ref: `item:${this.item.id}`,
        outcome: result.outcome,
        grade: result.grade,
        duration: result.responseTime,
        data: await this.#data(result),
      });
      this.state = "saved";
    } catch (error) {
      this.state = "unsaved";
      this.notice = messageOf(error);
    }
  }

  async #data(result: Result): Promise<Record<string, unknown>> {
    const subject = await tome.subject();
    const newest = subject.payloadSchemas.reduce((a, b) => (b.version > a.version ? b : a));
    const declared = newest.kinds.attempt?.properties ?? {};
    const measured: Record<string, unknown> = {
      heard: this.item!.answer,
      answer: result.given,
      responseTime: result.responseTime,
      replays: result.replays,
    };
    const known = Object.entries(measured).filter(([name]) => name in declared);
    return { ...Object.fromEntries(known), ...this.#extra };
  }

  #keyFor(choice: string, index: number, options: string[]): string {
    return options.every((option) => option.length === 1) ? choice.toLowerCase() : String(index + 1);
  }

  #onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (event.key === " ") {
      if (target.closest("button")) return;
      event.preventDefault();
      void this.#play();
      return;
    }
    if (this.state !== "answering") return;
    const options = this.#options;
    const index = options.findIndex((choice, i) => this.#keyFor(choice, i, options) === event.key.toLowerCase());
    if (index !== -1) {
      event.preventDefault();
      this.#decide(options[index]);
    }
  }

  #onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const input = this.querySelector<HTMLInputElement>(".tome-input");
    if (input && input.value.trim()) this.#decide(input.value);
  }

  #answerState(choice: string): string | typeof nothing {
    if (!this.result || !this.item) return nothing;
    if (normalize(choice) === normalize(this.item.answer)) return "correct";
    return normalize(choice) === normalize(this.result.given) ? "wrong" : "faded";
  }

  #verdict(result: Result) {
    const seconds = `${(result.responseTime / 1000).toFixed(2)} s`;
    const text =
      result.outcome === "correct"
        ? `Right · ${seconds}`
        : result.outcome === "wrong"
          ? `You answered ${result.given} · ${seconds}`
          : "Out of time";
    return html`<p class="tome-say">${this.item!.answer}</p>
      <p class="tome-verdict" data-state=${result.outcome}>${text}</p>`;
  }

  #respond(answering: boolean) {
    const options = this.#options;
    if (options.length === 0) {
      return html`<form class="tome-respond" @submit=${(event: SubmitEvent) => this.#onSubmit(event)}>
        <input
          class="tome-input"
          type="text"
          aria-label="Your answer"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          .value=${this.result?.given ?? ""}
          ?disabled=${!answering}
        />
        <button type="submit" class="tome-submit" ?disabled=${!answering}>Answer</button>
      </form>`;
    }
    return html`<div class="tome-answers" role="group" aria-label="What did you hear?">
      ${options.map(
        (choice, index) => html`<button
          type="button"
          class="tome-answer"
          data-choice=${choice}
          data-state=${this.#answerState(choice)}
          aria-label=${choice}
          ?disabled=${!answering}
          @click=${() => this.#decide(choice)}
        >
          <b>${choice}</b><kbd>${this.#keyFor(choice, index, options)}</kbd>
        </button>`,
      )}
    </div>`;
  }

  protected override render() {
    const notice = this.notice ? html`<p class="tome-notice" role="alert">${this.notice}</p>` : nothing;
    if (this.state === "loading") {
      return html`<div class="tome-audio" data-state="loading"><p class="tome-hint">Loading…</p></div>`;
    }
    if (this.state === "error" || !this.item) {
      return html`<div class="tome-audio" data-state="error">${notice}</div>`;
    }
    const item = this.item;
    const started = this.state !== "ready";
    const answering = this.state === "answering";
    const label = item.audio ? (started ? "Play it again" : "Play the sound") : "Start";
    const hint = item.audio ? (started ? "Tap to hear it again" : "Tap to play") : started ? "" : "Tap to start";
    const seconds = item.timeLimitSeconds;
    return html`
      <div class="tome-audio" data-state=${this.state} aria-busy=${this.state === "saving" ? "true" : "false"}>
        <div class="tome-stage">
          <button
            type="button"
            class="tome-play"
            aria-label=${label}
            ?data-playing=${this.playing}
            ?disabled=${!item.audio && started}
            @click=${() => this.#play()}
          >
            ${PLAY_ICON}
          </button>
          ${item.prompt && started ? html`<p class="tome-prompt">${item.prompt}</p>` : nothing}
          <p class="tome-hint">${hint}${hint ? html` · <kbd>Space</kbd>` : nothing}</p>
          ${answering && seconds !== undefined
            ? html`<div class="tome-countdown" aria-hidden="true"><span style="animation-duration: ${seconds}s"></span></div>`
            : nothing}
          <div class="tome-feedback" aria-live="polite">${this.result ? this.#verdict(this.result) : nothing}</div>
        </div>
        ${this.#respond(answering)}
        ${this.state === "unsaved"
          ? html`<button type="button" class="tome-retry" @click=${() => this.#save()}>Save again</button>`
          : nothing}
        ${notice}
      </div>
    `;
  }
}

customElements.define("tome-audio", TomeAudio);

declare global {
  interface HTMLElementTagNameMap {
    "tome-audio": TomeAudio;
  }
}
