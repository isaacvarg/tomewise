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

  const settingsOf = homeSubjects[0].settings;
  const morseLessons = ["0001-k-and-m", "0002-r", "0003-s", "0004-the-late-bump", "0005-a-the-short-pair", "0006-n-a-turned-round", "0007-why-the-gaps-are-long"];
  const letter = (answer, unlockedBy, tag) => ({
    id: `letter-${answer.toLowerCase()}`,
    type: "timed-audio",
    audio: `assets/audio/${answer.toLowerCase()}.wav`,
    answer,
    unlockedBy,
    tags: [tag],
    retired: false,
  });
  const inDays = (days) => new Date(Date.parse(TODAY) + days * DAY_MS).toISOString().slice(0, 10);
  const morseUnlocked = () => ({
    today: TODAY,
    items: [[0, 0], [1, 6], [2, -1], [3, 3], [4, 0]].map(([index, days]) => ({
      item: morseSubject.items[index],
      due: `${inDays(days)}T09:00:00.000Z`,
      dueOn: inDays(days),
    })),
  });
  const morseSubject = {
    id: "morse-code",
    name: "Morse code",
    settings: settingsOf,
    lessons: morseLessons,
    quizzes: [],
    exams: [],
    references: ["wpm-timing", "a-and-n-side-by-side"],
    itemSets: [],
    items: [
      letter("K", "0001-k-and-m", "letter"),
      letter("M", "0001-k-and-m", "letter"),
      letter("R", "0002-r", "letter"),
      letter("S", "0003-s", "letter"),
      letter("U", "0004-the-late-bump", "letter"),
      letter("A", "0005-a-the-short-pair", "second-five"),
      letter("N", "0006-n-a-turned-round", "second-five"),
    ],
    drills: [
      { id: "review", builtIn: true, name: "Review everything due", select: { from: "due", tags: [] }, format: "item" },
      { id: "listen-kmrsu", builtIn: false, name: "Listen · K M R S U", select: { from: "unlocked", tags: ["letter"] }, count: 12, format: "multiple-choice", timeLimits: { perItemSeconds: 5 } },
      { id: "listen-an", builtIn: false, name: "Listen · A N", select: { from: "unlocked", tags: ["second-five"] }, count: 12, format: "multiple-choice" },
    ],
    curriculum: {
      units: [
        { title: "Koch letters", milestones: [{ id: "first-five", title: "Copy K, M, R, S and U", status: "current", lessons: morseLessons.slice(0, 4), exam: "first-five" }] },
        { title: "More letters", milestones: [{ id: "next-five", title: "Copy the next five letters", status: "upcoming", lessons: morseLessons.slice(4, 6) }] },
      ],
    },
    payloadSchemas: [],
    goals: [{ id: "daily", per: "day", minutes: 10 }],
    charts: [],
  };

  function morseActivity() {
    const today = Date.parse(TODAY);
    const days = [];
    const goals = [];
    const week = [12, 10, 4, 11, 13, 6];
    for (let ago = 125; ago >= 0; ago--) {
      const date = new Date(today - ago * DAY_MS).toISOString().slice(0, 10);
      const r = seeded(ago + 7);
      const minutes = ago < week.length ? week[week.length - 1 - ago] : ago < 63 && r > 0.35 ? Math.round(r * 16) : 0;
      if (minutes > 0) days.push({ date, subjects: ["morse-code"], minutes });
      if (ago < week.length) goals.push({ subject: "morse-code", goal: morseSubject.goals[0], from: date, to: date, minutes, met: minutes >= 10 });
    }
    return { today: TODAY, days, streak: { days: 6, restDaysLeft: 1 }, goals };
  }

  function demoSeries(series, values) {
    const today = Date.parse(TODAY);
    const date = (index) => new Date(today - (values.length - 1 - index) * DAY_MS).toISOString().slice(0, 10);
    return { ...series, points: values.map((value, index) => ({ date: date(index), value })) };
  }

  const morseStats = () => ({
    totals: { durationMs: 252 * 60_000, sessions: 38, accuracy: 0.91 },
    charts: [
      demoSeries(
        { id: "response-time", title: "Response time", kind: "line", measure: "payload", aggregate: "median", unit: "ms" },
        Array.from({ length: 30 }, (_, day) => ([7, 15, 16].includes(day) ? null : Math.round(1450 - day * 19 + (seeded(day + 3) - 0.5) * 160))),
      ),
      demoSeries(
        { id: "minutes", title: "Minutes a day", kind: "bar", measure: "minutes", aggregate: "total", unit: "min" },
        [12, 9, 0, 14, 11, 10, 4, 13, 11, 6, 12, 15, 10, 6],
      ),
    ],
  });

  const firstFive = { id: "first-five", title: "Copy K, M, R, S and U" };
  const demoPrompts = {
    unwritten: { kind: "exam-unwritten", milestone: firstFive, exam: "first-five", say: "Prepare the exam for “Copy K, M, R, S and U”." },
    ungraded: { kind: "ungraded-explanations", count: 1, refs: ["lesson:0004-the-late-bump"], say: "Grade my Morse code explanation." },
  };
  const morseExplanations = [
    { id: "01STYLEGUIDEEXPLAIN0000002", ts: "2026-11-20T18:10:00.000Z", ref: "lesson:0004-the-late-bump", text: "U ends on a long beep, so it sounds late." },
    {
      id: "01STYLEGUIDEEXPLAIN0000001",
      ts: "2026-11-18T18:02:00.000Z",
      ref: "lesson:0002-r",
      text: "R is short, long, short: dit-dah-dit.",
      grade: { id: "01STYLEGUIDEGRADE000000001", ts: "2026-11-19T08:00:00.000Z", feedback: "Right. Next time say what makes it different from K, which is the same pattern flipped." },
    },
  ];

  const demoThemes = [
    { name: "meadow", label: "Meadow", description: "Playful and green, with leaves that rise when you start.", stylesheets: ["tokens.css", "theme.css"], script: "leaves.js" },
    { name: "paper", label: "Paper", description: "Calm and bookish: warm paper, serif headings, one rust accent.", stylesheets: ["tokens.css", "theme.css"] },
  ];
  const settings = { theme: data.themeName || "paper", start: "sequence", subjects: [] };
  const settingsBody = () => ({
    ...settings,
    themes: demoThemes.some((theme) => theme.name === settings.theme)
      ? demoThemes
      : [...demoThemes, { name: settings.theme, label: settings.theme, stylesheets: ["tokens.css"] }],
  });

  const demoSync = {
    enabled: true,
    stopped: false,
    lastPull: "2026-11-21T08:10:00.000Z",
    lastCommit: "2026-11-20T21:00:00.000Z",
    lastPush: "2026-11-20T21:00:00.000Z",
    lastError: null,
  };

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
    if (url.pathname === "/api/sync") {
      if (method === "POST") demoSync.lastPull = new Date().toISOString();
      return json(demoSync);
    }
    const setting = /^\/api\/settings\/(theme|start|subjects)$/.exec(url.pathname);
    if (method === "PUT" && setting) {
      settings[setting[1]] = JSON.parse(init.body).value;
      return json(settingsBody());
    }
    if (method !== "GET") return json({ error: "Not found" }, 404);
    if (url.pathname === "/api/settings") return json(settingsBody());
    if (url.pathname === "/api/activity") return json(url.searchParams.get("subject") === "morse-code" ? morseActivity() : homeActivity());
    if (url.pathname === "/api/subjects/morse-code") return json(morseSubject);
    if (url.pathname === "/api/subjects/morse-code/stats") return json(morseStats());
    if (url.pathname === "/api/subjects/morse-code/unlocked") return json(morseUnlocked());
    if (url.pathname === "/api/prompts") return json({ subjects: [{ subject: "morse-code", prompts: [demoPrompts.unwritten, demoPrompts.ungraded] }] });
    if (url.pathname === "/api/subjects/morse-code/prompts") {
      return json({ prompts: [demoPrompts.unwritten, demoPrompts.ungraded], explanations: morseExplanations });
    }
    if (url.pathname === "/api/subjects/morse-code/progress") return json({ completedLessons: morseLessons.slice(0, 4), milestones: { "first-five": "current", "next-five": "upcoming" } });
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
    "[data-styleguide-break]": ".tome-break",
    "[data-styleguide-start-list]": ".tome-picks",
    "[data-styleguide-settings]": '.tome-app[data-state="ready"]',
    "[data-styleguide-subject]": '.tome-app[data-state="ready"]:not(:has([aria-busy="true"]))',
    "[data-styleguide-no-charts]": ".tome-totals",
    "[data-styleguide-prompts]": ".tome-prompts",
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
