export const widgets: Record<string, () => Promise<unknown>> = {
  "tome-flashcard": () => import("./tome-flashcard.ts"),
  "tome-done": () => import("./tome-done.ts"),
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
