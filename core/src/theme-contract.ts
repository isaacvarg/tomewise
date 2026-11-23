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
  "tome-done": ["tome-done", "tome-done-button", "tome-exam-score", "tome-notice", "tome-score", "tome-score-sub", "tome-verdict"],
  "tome-drill": ["tome-actions", "tome-again", "tome-clock", "tome-close", "tome-count", "tome-drill", "tome-drill-bar", "tome-drill-item", "tome-drill-name", "tome-drill-next", "tome-drill-title", "tome-empty", "tome-empty-title", "tome-hint", "tome-kicker", "tome-next", "tome-notice", "tome-progress", "tome-saved", "tome-score", "tome-score-sub", "tome-stats", "tome-summary", "tome-summary-head"],
  "tome-exam-question": ["tome-exam-question", "tome-notice", "tome-question"],
  "tome-explain": ["tome-actions", "tome-explain", "tome-explain-text", "tome-hint", "tome-notice", "tome-prompt", "tome-save", "tome-verdict"],
  "tome-flashcard": ["tome-back", "tome-flashcard", "tome-front", "tome-grade", "tome-grades", "tome-hint", "tome-notice", "tome-reveal", "tome-stage", "tome-verdict"],
  "tome-routine": ["tome-grade", "tome-grades", "tome-hint", "tome-next", "tome-notice", "tome-progress", "tome-routine", "tome-routine-name", "tome-stage", "tome-start", "tome-step", "tome-verdict"],
  "tome-timer": ["tome-clock", "tome-notice", "tome-timer", "tome-timer-controls", "tome-timer-reset", "tome-timer-toggle", "tome-verdict"],
  "tome-typed": ["tome-entry", "tome-feedback", "tome-hint", "tome-input", "tome-notice", "tome-prompt", "tome-retry", "tome-skip", "tome-stage", "tome-submit", "tome-typed", "tome-verdict"],
};

export const appClasses: readonly string[] = [
  "tome-actions", "tome-activity", "tome-again", "tome-app", "tome-ask", "tome-ask-go", "tome-ask-say", "tome-back",
  "tome-break", "tome-break-continue", "tome-break-done", "tome-break-next", "tome-break-skip", "tome-cell",
  "tome-chart", "tome-chart-area", "tome-chart-bar", "tome-chart-dot", "tome-chart-grid", "tome-chart-line",
  "tome-chart-plot", "tome-chart-x", "tome-chart-y", "tome-charts", "tome-check", "tome-copy", "tome-curriculum",
  "tome-drill-go", "tome-drill-name", "tome-drill-sub", "tome-drills", "tome-due", "tome-due-how", "tome-due-quiz", "tome-due-what",
  "tome-exam", "tome-explanation", "tome-explanation-feedback", "tome-explanation-from", "tome-explanation-text",
  "tome-explanations", "tome-field", "tome-field-name", "tome-fields", "tome-glossary", "tome-goal", "tome-goal-bar", "tome-goal-num", "tome-goal-week", "tome-header",
  "tome-hear", "tome-heat-days", "tome-heat-legend", "tome-heatmap", "tome-heatmap-wrap", "tome-hint",
  "tome-home-link", "tome-kicker", "tome-lede", "tome-lessons", "tome-look-again", "tome-look-item", "tome-look-why",
  "tome-mark", "tome-mark-letter", "tome-meta", "tome-meta-narrow", "tome-meta-wide", "tome-milestone",
  "tome-milestone-done", "tome-milestone-head", "tome-milestone-plain", "tome-notice", "tome-num", "tome-option", "tome-option-name",
  "tome-option-text", "tome-options", "tome-order", "tome-order-handle", "tome-order-move", "tome-order-name",
  "tome-order-row", "tome-overview", "tome-pick", "tome-pick-how", "tome-pick-name", "tome-picks", "tome-prompts",
  "tome-quiz-answer", "tome-quiz-answers", "tome-quiz-given", "tome-quiz-mark", "tome-quiz-me", "tome-quiz-prompt",
  "tome-reference", "tome-row", "tome-runner", "tome-runner-bar", "tome-runner-summary", "tome-score",
  "tome-score-sub", "tome-section", "tome-section-head", "tome-settings", "tome-settings-actions",
  "tome-settings-cancel", "tome-settings-save", "tome-side", "tome-stage", "tome-start", "tome-stats", "tome-status",
  "tome-streak", "tome-streak-num", "tome-streak-text", "tome-subject", "tome-subject-ask", "tome-subject-name", "tome-subject-settings",
  "tome-subjects", "tome-summary-head", "tome-sync", "tome-sync-now", "tome-tab", "tome-tabs", "tome-term", "tome-term-when", "tome-term-word",
  "tome-terms", "tome-title", "tome-totals", "tome-unit", "tome-view",
];

export const requiredTokenNames = (kind?: TokenKind): string[] =>
  themeTokens.filter((token) => kind === undefined || token.kind === kind).map((token) => token.name);
