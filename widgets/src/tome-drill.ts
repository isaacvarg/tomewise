import { html, nothing, type PropertyValues } from "lit";
import type { Drill, Item, Subject } from "@tomewise/core";
import { type EndedSession, type Grade, type Outcome, tome, TomeError } from "./api.ts";
import { adoptStyles, messageOf, TomeElement } from "./element.ts";
import { labelOf, median, planDrill, present, WIDGET_FOR } from "./drill-plan.ts";
import { widgets } from "./loader.ts";

type State = "loading" | "error" | "empty" | "running" | "done";

export interface Answered {
  ref: string;
  outcome: Outcome;
  grade: Grade;
  duration: number;
  given?: string;
}

export interface DrillDone {
  drill: string;
  planned: number;
  timeUp: boolean;
  results: Answered[];
  session: EndedSession | undefined;
}

const PAUSE_RIGHT = 900;
const PAUSE_MISSED = 1600;
const FOCUSABLE = "input:not([disabled]):not([readonly]), button:not([disabled])";

const CSS = `
.tome-drill { display: flex; flex-direction: column; gap: 1rem; padding: 1rem 1.1rem 1.2rem; background: var(--t-bg); color: var(--t-ink); font-family: var(--t-ui); }
.tome-drill > .tome-drill-bar { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: .8rem; }
.tome-drill > .tome-drill-bar:has(> .tome-close) { grid-template-columns: auto 1fr auto auto; }
.tome-drill .tome-close { width: 2.75rem; height: 2.75rem; margin: -.4rem 0 -.4rem -.6rem; display: grid; place-items: center; border-radius: 50%; color: var(--t-muted); text-decoration: none; font-size: 1.4rem; line-height: 1; touch-action: manipulation; }
.tome-drill .tome-close:hover { background: var(--t-surface); }
.tome-drill .tome-close:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-drill-title { display: flex; flex-direction: column; min-width: 0; }
.tome-drill .tome-kicker { font-size: .72rem; color: var(--t-muted); letter-spacing: .05em; text-transform: uppercase; }
.tome-drill-name { font-size: .92rem; font-weight: 600; }
.tome-drill :is(.tome-count, .tome-clock) { font-size: .85rem; color: var(--t-muted); font-variant-numeric: tabular-nums; }
.tome-drill .tome-clock[data-state="low"] { color: var(--t-bad); }
.tome-drill > .tome-progress { height: 4px; background: var(--t-rule); border-radius: 99px; overflow: hidden; }
.tome-drill > .tome-progress span { display: block; height: 100%; background: var(--t-accent); transition: width 300ms ease; }
.tome-drill-item { display: flex; flex-direction: column; }
.tome-drill-next { display: flex; justify-content: center; }
.tome-drill :is(.tome-next, .tome-again) { font: 600 1rem var(--t-ui); padding: .8rem 1.2rem; min-height: 2.75rem; border: 0; border-radius: var(--t-radius); background: var(--t-accent); color: var(--t-accent-ink); cursor: pointer; touch-action: manipulation; }
.tome-drill .tome-again { width: 100%; }
.tome-drill :is(.tome-next, .tome-again):focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-drill > :is(.tome-empty, .tome-summary) { display: flex; flex-direction: column; gap: 1rem; }
.tome-drill > .tome-empty { align-items: center; justify-content: center; text-align: center; min-height: 12rem; }
.tome-drill > .tome-empty p { margin: 0; }
.tome-empty-title { font-family: var(--t-display); font-size: 1.4rem; }
.tome-drill > .tome-empty .tome-hint, .tome-drill > .tome-hint { margin: 0; color: var(--t-muted); font-size: .85rem; }
.tome-summary-head { display: flex; flex-direction: column; gap: .1rem; padding-top: .5rem; }
.tome-score { font-family: var(--t-display); font-size: 4rem; line-height: 1; font-variant-numeric: tabular-nums; }
.tome-score-sub { color: var(--t-muted); font-size: .9rem; }
.tome-stats { list-style: none; margin: 0; padding: .1rem .9rem; background: var(--t-surface); border-radius: var(--t-radius); }
.tome-stats li { display: flex; justify-content: space-between; gap: 1rem; padding: .6rem 0; border-top: 1px solid var(--t-rule); font-size: .88rem; }
.tome-stats li:first-child { border-top: 0; }
.tome-stats span:last-child { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.tome-saved { margin: 0; font-size: .85rem; color: var(--t-muted); }
.tome-drill[data-mode="quiz"] :is(.tome-feedback, .tome-verdict) { visibility: hidden; }
.tome-drill[data-mode="quiz"] :is(.tome-answer, .tome-input)[data-state] { background: var(--t-bg); border-color: var(--t-rule); color: var(--t-ink); opacity: 1; }
@media (prefers-reduced-motion: reduce) { .tome-drill > .tome-progress span { transition: none; } }
`;

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export class TomeDrill extends TomeElement {
  static override properties = {
    drill: { type: String },
    quiz: { type: Boolean },
    payload: { type: String },
    close: { type: String },
    state: { state: true },
    notice: { state: true },
    current: { state: true },
    index: { state: true },
    results: { state: true },
    answered: { state: true },
    timeUp: { state: true },
    left: { state: true },
  };

  declare drill: string;
  declare quiz: boolean;
  declare payload: string;
  declare close: string;
  declare state: State;
  declare notice: string | undefined;
  declare current: HTMLElement | undefined;
  declare index: number;
  declare results: Answered[];
  declare answered: boolean;
  declare timeUp: boolean;
  declare left: number | undefined;

  #subjectName = "";
  #definition: Drill | undefined;
  #plan: Item[] = [];
  #run = 0;
  #autoplay = false;
  #pause: ReturnType<typeof setTimeout> | undefined;
  #deadline: number | undefined;
  #ticker: ReturnType<typeof setInterval> | undefined;
  #watcher: MutationObserver | undefined;
  #hostSummary = false;
  #scoreDisplay: Subject["settings"]["assessments"]["scoreDisplay"] = "number";

  constructor() {
    super();
    this.drill = "";
    this.quiz = false;
    this.payload = "";
    this.close = "";
    this.state = "loading";
    this.index = 0;
    this.results = [];
    this.answered = false;
    this.timeUp = false;
    for (const type of ["pointerdown", "keydown"]) {
      this.addEventListener(type, () => this.#startClock(), { capture: true, passive: true });
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome-drill", CSS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopTimers();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("drill") || changed.has("quiz") || changed.has("payload")) void this.#load();
  }

  get #drillId(): string {
    if (this.drill) return this.drill;
    const { kind, id } = tome.context;
    return kind === "drill" ? id : "review";
  }

  #stopTimers(): void {
    clearTimeout(this.#pause);
    clearInterval(this.#ticker);
    this.#pause = undefined;
    this.#ticker = undefined;
    this.#deadline = undefined;
    this.#watcher?.disconnect();
  }

  async #load(): Promise<void> {
    const run = ++this.#run;
    this.#stopTimers();
    this.state = "loading";
    this.notice = undefined;
    this.current = undefined;
    this.index = 0;
    this.results = [];
    this.answered = false;
    this.timeUp = false;
    this.#hostSummary = false;
    try {
      const { subject, drill, plan } = await this.#planned();
      if (run !== this.#run) return;
      this.#subjectName = subject.name;
      this.#scoreDisplay = subject.settings.assessments.scoreDisplay;
      this.#definition = drill;
      this.#plan = plan;
      const total = drill.timeLimits?.totalSeconds;
      this.left = total === undefined ? undefined : total * 1000;
      if (this.#plan.length === 0) {
        this.state = "empty";
        return;
      }
      this.state = "running";
      this.#show();
    } catch (error) {
      if (run !== this.#run) return;
      this.state = "error";
      this.notice = messageOf(error);
    }
  }

  async #planned(): Promise<{ subject: Subject; drill: Drill; plan: Item[] }> {
    const id = this.#drillId;
    const subject = await tome.subject();
    if (this.quiz) {
      const { drill, items } = await tome.quiz(/^quiz-(.+)$/.exec(id)?.[1]);
      return { subject, drill, plan: items.filter((item) => WIDGET_FOR[item.type] !== undefined) };
    }
    const drill = subject.drills.find((candidate) => candidate.id === id);
    if (!drill) {
      const known = subject.drills.map((candidate) => candidate.id).join(", ");
      throw new TomeError(`No drill "${id}" in ${subject.name}. Drills: ${known}.`);
    }
    const candidates = drill.select.from === "due" ? await tome.due() : await tome.unlocked();
    return { subject, drill, plan: planDrill(drill, candidates) };
  }

  get #quizMode(): boolean {
    return this.#definition?.quiz === true;
  }

  #show(): void {
    const drill = this.#definition!;
    const item = this.#plan[this.index]!;
    const { tag, attributes } = present(item, drill, this.#plan, this.payload);
    void widgets[tag]?.();
    const widget = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) widget.setAttribute(name, value);
    const run = this.#run;
    widget.addEventListener("tome-answered", (event) => {
      if (run === this.#run) this.#onAnswered(widget, (event as CustomEvent<Answered>).detail);
    });
    this.answered = false;
    this.current = widget;
    this.#whenReady(widget);
  }

  #whenReady(widget: HTMLElement): void {
    this.#watcher?.disconnect();
    const autoplay = this.#autoplay;
    const ready = () => {
      const control = widget.querySelector<HTMLElement>(FOCUSABLE);
      if (!control) return false;
      control.focus({ preventScroll: true });
      if (autoplay) void (widget as HTMLElement & { play?: () => Promise<void> }).play?.();
      return true;
    };
    void this.updateComplete.then(() => {
      if (this.current !== widget || ready()) return;
      this.#watcher = new MutationObserver(() => {
        if (this.current !== widget || ready()) this.#watcher?.disconnect();
      });
      this.#watcher.observe(widget, { childList: true, subtree: true });
    });
  }

  #onAnswered(widget: HTMLElement, detail: Answered): void {
    this.results = [...this.results, detail];
    if (this.state !== "running" || widget !== this.current) return;
    this.answered = true;
    this.#autoplay = true;
    if (this.#quizMode) {
      this.#next();
      return;
    }
    this.#pause = setTimeout(() => this.#next(), detail.outcome === "correct" ? PAUSE_RIGHT : PAUSE_MISSED);
    void this.updateComplete.then(() => this.querySelector<HTMLButtonElement>(".tome-next")?.focus({ preventScroll: true }));
  }

  #next(): void {
    if (this.state !== "running" || !this.answered) return;
    clearTimeout(this.#pause);
    this.#pause = undefined;
    if (this.index + 1 >= this.#plan.length) {
      this.#finish(false);
      return;
    }
    this.index++;
    this.#show();
  }

  #startClock(): void {
    const total = this.#definition?.timeLimits?.totalSeconds;
    if (this.state !== "running" || total === undefined || this.#deadline !== undefined) return;
    this.#deadline = performance.now() + total * 1000;
    this.#ticker = setInterval(() => {
      this.left = Math.max(0, this.#deadline! - performance.now());
      if (this.left === 0) this.#finish(true);
    }, 200);
  }

  #finish(timeUp: boolean): void {
    this.#stopTimers();
    this.timeUp = timeUp;
    this.current = undefined;
    const detail: DrillDone = {
      drill: this.#drillId,
      planned: this.#plan.length,
      timeUp,
      results: this.results,
      session: tome.end(),
    };
    this.#hostSummary = !this.dispatchEvent(new CustomEvent("tome-drill-done", { bubbles: true, cancelable: true, detail }));
    this.state = "done";
    void this.updateComplete.then(() => this.querySelector<HTMLButtonElement>(".tome-again")?.focus({ preventScroll: true }));
  }

  #bar(count: string | typeof nothing) {
    const left = this.left;
    const total = this.#definition?.timeLimits?.totalSeconds;
    const timer =
      left === undefined || total === undefined
        ? nothing
        : html`<span class="tome-clock" role="timer" aria-label="Time left" data-state=${left <= 10_000 ? "low" : nothing}
            >${clock(left)}</span
          >`;
    const close = this.close
      ? html`<a class="tome-close" href=${this.close} aria-label="End session">×</a>`
      : nothing;
    return html`<header class="tome-drill-bar">
      ${close}
      <div class="tome-drill-title">
        <span class="tome-kicker">${this.#subjectName}</span>
        <span class="tome-drill-name">${this.#definition?.name}</span>
      </div>
      ${timer}
      <span class="tome-count">${count}</span>
    </header>`;
  }

  #progress(done: number) {
    const total = this.#plan.length;
    return html`<div
      class="tome-progress"
      role="progressbar"
      aria-label="Progress"
      aria-valuemin="0"
      aria-valuemax=${total}
      aria-valuenow=${done}
    >
      <span style="width: ${total ? (done / total) * 100 : 0}%"></span>
    </div>`;
  }

  #summary() {
    const results = this.results;
    const right = results.filter((result) => result.outcome === "correct").length;
    const skipped = results.filter((result) => result.outcome === "skipped").length;
    const time = median(results.filter((result) => result.outcome !== "skipped").map((result) => result.duration));
    const labels = new Map(this.#plan.map((item) => [`item:${item.id}`, labelOf(item)]));
    const missed = new Map<string, number>();
    for (const result of results) {
      if (result.outcome === "correct") continue;
      const label = labels.get(result.ref) ?? result.ref;
      missed.set(label, (missed.get(label) ?? 0) + 1);
    }
    const missedText = [...missed]
      .sort((a, b) => b[1] - a[1])
      .map(([label, times]) => (times > 1 ? `${label} (${times}×)` : label))
      .join(", ");
    const score = results.length ? `${Math.round((right / results.length) * 100)}%` : "–";
    const hidden = this.#quizMode && this.#scoreDisplay === "hidden";
    return html`<section class="tome-summary" aria-label="Summary">
      <div class="tome-summary-head">
        <span class="tome-kicker">${this.timeUp ? "Time's up" : this.#quizMode ? "Quiz done" : "Drill done"}</span>
        ${hidden
          ? nothing
          : html`<span class="tome-score">${score}</span>
              <span class="tome-score-sub">${right} of ${results.length} right</span>`}
      </div>
      <ul class="tome-stats">
        ${results.length < this.#plan.length
          ? html`<li><span>Answered</span><span>${results.length} of ${this.#plan.length}</span></li>`
          : nothing}
        <li><span>Median answer time</span><span>${time === undefined ? "–" : seconds(time)}</span></li>
        ${skipped ? html`<li><span>Skipped or out of time</span><span>${skipped}</span></li>` : nothing}
        <li><span>Missed</span><span>${missedText || "none"}</span></li>
      </ul>
      <p class="tome-saved">Every answer is saved to your history and updates that item's review schedule.</p>
      <div class="tome-actions">
        <button type="button" class="tome-again" @click=${() => this.#load()}>Run again</button>
      </div>
    </section>`;
  }

  protected override render() {
    const notice = this.notice ? html`<p class="tome-notice" role="alert">${this.notice}</p>` : nothing;
    if (this.state === "loading") {
      return html`<div class="tome-drill" data-state="loading"><p class="tome-hint">Loading…</p></div>`;
    }
    if (this.state === "error" || !this.#definition) {
      return html`<div class="tome-drill" data-state="error">${notice}</div>`;
    }
    const total = this.#plan.length;
    if (this.state === "empty") {
      const due = this.#definition.select.from === "due" && !this.#quizMode;
      return html`<div class="tome-drill" data-state="empty">
        ${this.#bar(nothing)}
        <div class="tome-empty" role="status">
          <p class="tome-empty-title">${due ? "Nothing is due" : this.#quizMode ? "Nothing to quiz yet" : "Nothing to drill yet"}</p>
          <p class="tome-hint">
            ${due ? "You're up to date. Come back later." : `Complete a lesson to unlock items for this ${this.#quizMode ? "quiz" : "drill"}.`}
          </p>
        </div>
      </div>`;
    }
    if (this.state === "done") {
      return html`<div class="tome-drill" data-state="done" data-mode=${this.#quizMode ? "quiz" : nothing}>
        ${this.#bar(`${this.results.length} / ${total}`)} ${this.#progress(total)}
        ${this.#hostSummary ? nothing : this.#summary()}
      </div>`;
    }
    return html`<div class="tome-drill" data-state="running" data-mode=${this.#quizMode ? "quiz" : nothing}>
      ${this.#bar(`${this.index + 1} / ${total}`)} ${this.#progress(this.index + (this.answered ? 1 : 0))}
      <div class="tome-drill-item">${this.current}</div>
      ${this.answered
        ? html`<div class="tome-drill-next">
            <button type="button" class="tome-next" @click=${() => this.#next()}>
              ${this.index + 1 >= total ? "See summary" : "Next"}
            </button>
          </div>`
        : nothing}
    </div>`;
  }
}

customElements.define("tome-drill", TomeDrill);

declare global {
  interface HTMLElementTagNameMap {
    "tome-drill": TomeDrill;
  }
}
