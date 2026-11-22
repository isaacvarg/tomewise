(() => {
  const data = JSON.parse(document.getElementById("styleguide-data").textContent);
  const realFetch = window.fetch.bind(window);
  const UNREACHABLE = "item:offline";
  let counter = 0;

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const eventId = () => `01STYLEGUIDE${String(++counter).padStart(14, "0")}`;

  async function fakeApi(url, init = {}) {
    const method = (init.method ?? "GET").toUpperCase();
    const subject = `/api/subjects/${encodeURIComponent(data.subject.id)}`;
    if (method === "POST" && url.pathname === "/api/events") {
      const body = JSON.parse(init.body);
      const events = Array.isArray(body) ? body : [body];
      if (events.some((event) => event.ref === UNREACHABLE)) throw new TypeError("Failed to fetch");
      return json({ events: events.map((event) => ({ id: eventId(), ts: new Date().toISOString(), ...event })) }, 201);
    }
    if (method !== "GET") return json({ error: "Not found" }, 404);
    if (url.pathname === subject) return json(data.subject);
    if (url.pathname === `${subject}/events`) return json({ events: [] });
    if (url.pathname === `${subject}/due`) return json({ due: [] });
    return json({ error: `No demo data for ${url.pathname}` }, 404);
  }

  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin === location.origin && url.pathname.startsWith("/api/")) return fakeApi(url, init);
    return realFetch(input, init);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function find(root, selector, timeout = 5000) {
    const until = Date.now() + timeout;
    for (;;) {
      const found = root.querySelector(selector);
      if (found && !found.disabled) return found;
      if (Date.now() > until) throw new Error(`Styleguide: no ${selector} in <${root.localName}>`);
      await sleep(25);
    }
  }

  const click = (selector) => async (root) => (await find(root, selector)).click();
  const fill = (selector, value) => async (root) => {
    const input = await find(root, selector);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const appear = (selector) => async (root) => void (await find(root, selector));

  const demos = {
    "tome-flashcard": {
      reveal: [click(".tome-reveal")],
      good: [click(".tome-reveal"), click('.tome-grade[data-grade="3"]'), appear(".tome-verdict")],
      again: [click(".tome-reveal"), click('.tome-grade[data-grade="1"]'), appear(".tome-verdict")],
    },
    "tome-choice": {
      right: [click(".tome-answer:nth-child(2)"), appear(".tome-verdict")],
      wrong: [click(".tome-answer:nth-child(1)"), appear(".tome-verdict")],
      skip: [click(".tome-skip"), appear(".tome-verdict")],
      unsaved: [click(".tome-answer:nth-child(3)"), appear(".tome-retry")],
    },
    "tome-typed": {
      right: [fill(".tome-input", "gracias"), click(".tome-submit"), appear(".tome-verdict")],
      wrong: [fill(".tome-input", "de nada"), click(".tome-submit"), appear(".tome-verdict")],
    },
    "tome-audio": {
      start: [click(".tome-play")],
      right: [click(".tome-play"), click('.tome-answer[data-choice="K"]'), appear(".tome-verdict")],
      wrong: [click(".tome-play"), click('.tome-answer[data-choice="M"]'), appear(".tome-verdict")],
    },
    "tome-routine": {
      start: [click(".tome-start")],
      timed: [click(".tome-start"), click(".tome-next"), appear(".tome-timer")],
      finish: [click(".tome-start"), click(".tome-next"), click(".tome-next"), click(".tome-next"), appear(".tome-grades")],
      good: [
        click(".tome-start"),
        click(".tome-next"),
        click(".tome-next"),
        click(".tome-next"),
        click('.tome-grade[data-grade="3"]'),
        appear(".tome-verdict"),
      ],
    },
    "tome-timer": {
      pause: [click(".tome-timer-toggle"), click(".tome-timer-toggle")],
    },
    "tome-explain": {
      save: [fill(".tome-explain-text", "A long, a short, a long: dah-di-dah."), click(".tome-save")],
    },
    "tome-exam-question": {
      answer: [fill(".tome-input", "muchas gracias"), click(".tome-submit"), appear(".tome-verdict")],
    },
    "tome-done": {
      done: [click(".tome-done-button"), appear(".tome-verdict")],
    },
    "tome-drill": {
      finish: [click(".tome-reveal"), click('.tome-grade[data-grade="3"]'), appear(".tome-summary")],
    },
  };

  async function settle(widget) {
    await customElements.whenDefined(widget.localName);
    await find(widget, ":scope > *");
    await sleep(50);
  }

  async function run(widget) {
    const steps = demos[widget.localName]?.[widget.dataset.demo];
    if (!steps) throw new Error(`Styleguide: no demo "${widget.dataset.demo}" for <${widget.localName}>`);
    await settle(widget);
    for (const step of steps) await step(widget);
  }

  async function ready() {
    for (const name of document.querySelectorAll("[data-styleguide-theme]")) name.textContent = data.themeName;
    const widgets = [...document.querySelectorAll("body :not(:defined)")].filter((element) => element.localName.startsWith("tome-"));
    await Promise.all(widgets.map(settle));
    const results = await Promise.allSettled([...document.querySelectorAll("[data-demo]")].map(run));
    const failed = results.filter((result) => result.status === "rejected").map((result) => String(result.reason?.message ?? result.reason));
    await sleep(300);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.documentElement.dataset.styleguide = failed.length === 0 ? "ready" : "failed";
    if (failed.length > 0) document.documentElement.dataset.styleguideErrors = failed.join("\n");
  }

  document.addEventListener("DOMContentLoaded", () => void ready());
})();
