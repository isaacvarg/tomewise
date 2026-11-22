const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const CORRECT = '.tome-answer[data-state="correct"], .tome-input[data-state="correct"], .tome-verdict[data-state="correct"]';

function leaves(from, count) {
  if (reducedMotion.matches || !from.isConnected) return;
  const box = from.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const leaf = document.createElement("span");
    leaf.className = "meadow-leaf";
    leaf.setAttribute("aria-hidden", "true");
    leaf.style.left = `${box.left + box.width / 2}px`;
    leaf.style.top = `${box.top + box.height * 0.3}px`;
    leaf.style.setProperty("--dx", `${(i - (count - 1) / 2) * 18}px`);
    leaf.style.setProperty("--rot", `${(i - (count - 1) / 2) * 42}deg`);
    leaf.style.animationDelay = `${i * 40}ms`;
    leaf.addEventListener("animationend", () => leaf.remove());
    document.body.append(leaf);
  }
}

document.addEventListener("click", (event) => {
  const start = event.target instanceof Element ? event.target.closest(".tome-start") : null;
  if (start) leaves(start, 7);
}, { capture: true });

new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "attributes") {
      const target = record.target;
      if (target instanceof Element && target.matches(CORRECT) && record.oldValue !== "correct") leaves(target, 5);
      continue;
    }
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      const correct = node.matches(CORRECT) ? node : node.querySelector(CORRECT);
      if (correct) leaves(correct, 5);
    }
  }
}).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["data-state"],
  attributeOldValue: true,
});
