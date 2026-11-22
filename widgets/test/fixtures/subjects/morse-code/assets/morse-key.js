import { tome } from "/widgets/v1/tome.js";

class MorseKey extends HTMLElement {
  #item;
  #shownAt;

  async connectedCallback() {
    if (this.querySelector(".morse-key")) return;
    this.innerHTML = `
      <div class="morse-key tome-stage">
        <p class="tome-prompt"></p>
        <form class="tome-entry">
          <input class="tome-input" aria-label="Letter" autocomplete="off">
          <button class="tome-submit">Check</button>
        </form>
        <div class="tome-feedback" aria-live="polite"></div>
      </div>`;
    this.querySelector(".tome-prompt").textContent = this.getAttribute("pattern");
    this.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#answer(this.querySelector("input").value);
    });
    this.#item = await tome.item(this.getAttribute("ref"));
    this.#shownAt = performance.now();
  }

  async #answer(given) {
    const responseTime = Math.round(performance.now() - this.#shownAt);
    const correct = given.trim().toUpperCase() === this.#item.answer;
    const wpm = this.hasAttribute("wpm") ? Number(this.getAttribute("wpm")) : undefined;
    const saved = await tome
      .attempt(
        {
          ref: this.getAttribute("ref"),
          outcome: correct ? "correct" : "wrong",
          grade: correct ? 3 : 1,
          duration: responseTime,
          data: { heard: this.#item.answer, answer: given.trim(), responseTime, wpm },
        },
        this,
      )
      .catch(() => undefined);
    if (!saved) return;
    this.querySelector(".tome-feedback").innerHTML = `<p class="tome-verdict" data-state="${correct ? "correct" : "wrong"}"></p>`;
    this.querySelector(".tome-verdict").textContent = correct ? "Right" : `Not quite · it was ${this.#item.answer}`;
    if (this.hasAttribute("final")) await tome.complete(this).catch(() => undefined);
  }
}

customElements.define("morse-key", MorseKey);
