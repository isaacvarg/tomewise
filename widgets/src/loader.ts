export const widgets: Record<string, () => Promise<unknown>> = {
  "tome-flashcard": () => import("./tome-flashcard.ts"),
  "tome-choice": () => import("./tome-choice.ts"),
  "tome-typed": () => import("./tome-typed.ts"),
  "tome-audio": () => import("./tome-audio.ts"),
  "tome-drill": () => import("./tome-drill.ts"),
  "tome-exam-question": () => import("./tome-exam-question.ts"),
  "tome-done": () => import("./tome-done.ts"),
  "tome-routine": () => import("./tome-routine.ts"),
  "tome-timer": () => import("./tome-timer.ts"),
};

export function loadWidgets(root: ParentNode): void {
  const load = (node: ParentNode) => {
    for (const [tag, define] of Object.entries(widgets)) {
      if (!customElements.get(tag) && node.querySelector(tag)) void define();
    }
  };
  load(root);
  new MutationObserver(() => load(root)).observe(root, { childList: true, subtree: true });
}
