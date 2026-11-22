export type TokenKind = "color" | "font" | "length";

export interface ContractToken {
  name: `--t-${string}`;
  kind: TokenKind;
  usedFor: string;
}

export const themeTokens: readonly ContractToken[] = [
  { name: "--t-bg", kind: "color", usedFor: "page background; buttons and inputs" },
  { name: "--t-surface", kind: "color", usedFor: "widget and card background" },
  { name: "--t-ink", kind: "color", usedFor: "text" },
  { name: "--t-muted", kind: "color", usedFor: "secondary text: hints, kickers, skip" },
  { name: "--t-rule", kind: "color", usedFor: "borders and dividers" },
  { name: "--t-accent", kind: "color", usedFor: "primary buttons, links, focus rings, progress" },
  { name: "--t-accent-ink", kind: "color", usedFor: "text on `--t-accent`" },
  { name: "--t-good", kind: "color", usedFor: "correct: text and borders" },
  { name: "--t-good-bg", kind: "color", usedFor: "correct: background" },
  { name: "--t-bad", kind: "color", usedFor: "wrong, errors and notices: text and borders" },
  { name: "--t-bad-bg", kind: "color", usedFor: "wrong, errors and notices: background" },
  { name: "--t-heat-0", kind: "color", usedFor: "heatmap: a day with no practice" },
  { name: "--t-heat-1", kind: "color", usedFor: "heatmap: least practice" },
  { name: "--t-heat-2", kind: "color", usedFor: "heatmap: some practice" },
  { name: "--t-heat-3", kind: "color", usedFor: "heatmap: more practice" },
  { name: "--t-heat-4", kind: "color", usedFor: "heatmap: most practice" },
  { name: "--t-display", kind: "font", usedFor: "display font: headings, prompts, fronts, scores" },
  { name: "--t-ui", kind: "font", usedFor: "interface and body font" },
  { name: "--t-mono", kind: "font", usedFor: "monospace: `<kbd>`, code, clocks" },
  { name: "--t-radius", kind: "length", usedFor: "corner radius" },
  { name: "--t-cell-radius", kind: "length", usedFor: "heatmap cell corner radius" },
];

export const widgetClasses: Readonly<Record<string, readonly string[]>> = {
  "tome-audio": ["tome-answer", "tome-answers", "tome-audio", "tome-countdown", "tome-feedback", "tome-hint", "tome-input", "tome-notice", "tome-play", "tome-prompt", "tome-respond", "tome-retry", "tome-say", "tome-stage", "tome-submit", "tome-verdict"],
  "tome-choice": ["tome-answer", "tome-answers", "tome-choice", "tome-feedback", "tome-hint", "tome-notice", "tome-prompt", "tome-retry", "tome-skip", "tome-stage", "tome-verdict"],
  "tome-done": ["tome-done", "tome-done-button", "tome-notice", "tome-verdict"],
  "tome-drill": ["tome-actions", "tome-again", "tome-clock", "tome-count", "tome-drill", "tome-drill-bar", "tome-drill-item", "tome-drill-name", "tome-drill-next", "tome-drill-title", "tome-empty", "tome-empty-title", "tome-hint", "tome-kicker", "tome-next", "tome-notice", "tome-progress", "tome-saved", "tome-score", "tome-score-sub", "tome-stats", "tome-summary", "tome-summary-head"],
  "tome-exam-question": ["tome-exam-question", "tome-notice", "tome-question"],
  "tome-explain": ["tome-actions", "tome-explain", "tome-explain-text", "tome-hint", "tome-notice", "tome-prompt", "tome-save", "tome-verdict"],
  "tome-flashcard": ["tome-back", "tome-flashcard", "tome-front", "tome-grade", "tome-grades", "tome-hint", "tome-notice", "tome-reveal", "tome-stage", "tome-verdict"],
  "tome-routine": ["tome-grade", "tome-grades", "tome-hint", "tome-next", "tome-notice", "tome-progress", "tome-routine", "tome-routine-name", "tome-stage", "tome-start", "tome-step", "tome-verdict"],
  "tome-timer": ["tome-clock", "tome-notice", "tome-timer", "tome-timer-controls", "tome-timer-reset", "tome-timer-toggle", "tome-verdict"],
  "tome-typed": ["tome-entry", "tome-feedback", "tome-hint", "tome-input", "tome-notice", "tome-prompt", "tome-retry", "tome-skip", "tome-stage", "tome-submit", "tome-typed", "tome-verdict"],
};

export const appClasses: readonly string[] = [
  "tome-activity", "tome-app", "tome-cell", "tome-due", "tome-header", "tome-heat-days", "tome-heat-legend", "tome-heatmap",
  "tome-heatmap-wrap", "tome-kicker", "tome-runner", "tome-runner-bar", "tome-section", "tome-section-head", "tome-stage",
  "tome-start", "tome-streak", "tome-subject", "tome-subject-name", "tome-subjects", "tome-title",
];

export const requiredTokenNames = (kind?: TokenKind): string[] =>
  themeTokens.filter((token) => kind === undefined || token.kind === kind).map((token) => token.name);
