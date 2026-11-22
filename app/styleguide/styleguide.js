(() => {
  const data = JSON.parse(document.getElementById("styleguide-data").textContent);
  const realFetch = window.fetch.bind(window);
  const UNREACHABLE = "item:offline";
  let counter = 0;

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const TODAY = "2026-11-21";
  const DAY_MS = 86_400_000;
  const homeSubjects = [
    { id: "morse-code", name: "Morse code", due: 9 },
    { id: "spanish", name: "Spanish", due: 4 },
    { id: "yoga", name: "Yoga", due: 0 },
    { id: "cube", name: "3x3 cube", due: 0 },
  ].map((subject) => ({ ...subject, settings: { timezone: "UTC", weekStart: "monday", minimumSessionSeconds: 60 } }));

  const seeded = (n) => {
    const x = Math.sin(n * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  };

  function homeActivity() {
    const today = Date.parse(TODAY);
    const days = [];
    for (let ago = 364; ago >= 0; ago--) {
      const r = seeded(ago);
      let active = r < 0.3 ? 0 : r < 0.5 ? 1 : r < 0.72 ? 2 : r < 0.9 ? 3 : 4;
      if (ago < 6) active = Math.max(active, 1 + (ago % 3));
      if (ago === 6) active = 0;
      if (active === 0) continue;
      const date = new Date(today - ago * DAY_MS).toISOString().slice(0, 10);
      days.push({ date, subjects: homeSubjects.slice(0, active).map((subject) => subject.id) });
    }
    return { today: TODAY, days, streak: { days: 6, restDaysLeft: 1 }, goals: [] };
  }

  const dueFor = (subject) =>
    Array.from({ length: subject.due }, (_, index) => ({ item: { id: `${subject.id}-${index + 1}`, type: "flashcard" }, due: null }));

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
    if (url.pathname === "/api/activity") return json(homeActivity());
    if (url.pathname === "/api/subjects") return json({ subjects: homeSubjects.map(({ due, ...subject }) => subject) });
    const homeSubject = homeSubjects.find((candidate) => url.pathname === `/api/subjects/${candidate.id}/due`);
    if (homeSubject) return json({ due: dueFor(homeSubject) });
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

  const APP_MOUNTS = {
    "[data-styleguide-home]": '.tome-app[data-state="ready"]',
    "[data-styleguide-runner]": '.tome-runner[data-state="running"] .tome-drill-item > *',
    "[data-styleguide-summary]": ".tome-runner-summary",
  };

  async function appReady(mount, selector) {
    if (!document.querySelector("script[data-styleguide-app]")) {
      const note = document.createElement("p");
      note.className = "styleguide-unbuilt";
      note.textContent = "The dashboard isn't built. Run pnpm build:app to see it here.";
      mount.append(note);
      return;
    }
    await find(mount, selector, 10000);
  }

  async function ready() {
    for (const name of document.querySelectorAll("[data-styleguide-theme]")) name.textContent = data.themeName;
    const widgets = [...document.querySelectorAll("body :not(:defined)")].filter((element) => element.localName.startsWith("tome-"));
    await Promise.all(widgets.map(settle));
    const results = await Promise.allSettled([
      ...Object.entries(APP_MOUNTS).flatMap(([mounts, selector]) =>
        [...document.querySelectorAll(mounts)].map((mount) => appReady(mount, selector)),
      ),
      ...[...document.querySelectorAll("[data-demo]")].map(run),
    ]);
    const failed = results.filter((result) => result.status === "rejected").map((result) => String(result.reason?.message ?? result.reason));
    await sleep(300);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.documentElement.dataset.styleguide = failed.length === 0 ? "ready" : "failed";
    if (failed.length > 0) document.documentElement.dataset.styleguideErrors = failed.join("\n");
  }

  document.addEventListener("DOMContentLoaded", () => void ready());
})();
