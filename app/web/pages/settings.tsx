import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Settings as SavedSettings, type StartMode, type Subject, type ThemeChoice } from "../api.ts";
import { inSavedOrder } from "../home/model.ts";
import { useLoad } from "../load.ts";
import { Failed, Screen } from "../screen.tsx";
import { needsReload, previewTheme } from "../settings/theme-preview.ts";

interface SettingsData {
  settings: SavedSettings;
  subjects: Subject[];
}

async function loadSettings(): Promise<SettingsData> {
  const [settings, subjects] = await Promise.all([api.settings(), api.subjects()]);
  return { settings, subjects: inSavedOrder(subjects, settings.subjects) };
}

const backLink = (
  <Link className="tome-home-link" to="/">
    Today
  </Link>
);

export function Settings({ reloadForThemeScripts = true }: { reloadForThemeScripts?: boolean }) {
  const loaded = useLoad(loadSettings);
  if (loaded.state !== "ready") {
    return (
      <Screen kicker={backLink} title="Settings" state={loaded.state}>
        {loaded.state === "loading" ? <p className="tome-hint">Loading…</p> : <Failed error={loaded.error} />}
      </Screen>
    );
  }
  const { settings, subjects } = loaded.data;
  return (
    <Screen kicker={backLink} title="Settings">
      <ThemeSetting saved={settings.theme} themes={settings.themes} reloadForScripts={reloadForThemeScripts} />
      <StartSetting saved={settings.start} />
      <SubjectOrder initial={subjects} />
    </Screen>
  );
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function ThemeSetting({ saved: initial, themes, reloadForScripts }: { saved: string; themes: ThemeChoice[]; reloadForScripts: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [picked, setPicked] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();
  const restore = useRef<(() => void) | null>(null);

  useEffect(() => () => restore.current?.(), []);

  function pick(theme: ThemeChoice) {
    restore.current?.();
    restore.current = theme.name === saved ? null : previewTheme(theme);
    setPicked(theme.name);
    setError(undefined);
  }

  function cancel() {
    restore.current?.();
    restore.current = null;
    setPicked(saved);
    setError(undefined);
  }

  async function save() {
    setSaving(true);
    try {
      const next = await api.saveSetting("theme", picked);
      restore.current = null;
      setSaved(next.theme);
      setError(undefined);
      const theme = themes.find((candidate) => candidate.name === next.theme);
      if (reloadForScripts && theme && needsReload(theme, themes)) location.reload();
    } catch (failure) {
      setError(errorOf(failure));
    } finally {
      setSaving(false);
    }
  }

  const changed = picked !== saved;
  return (
    <section className="tome-section tome-settings" data-setting="theme" aria-labelledby="setting-theme">
      <div className="tome-section-head">
        <h3 id="setting-theme">Theme</h3>
      </div>
      <div className="tome-options" role="radiogroup" aria-labelledby="setting-theme">
        {themes.map((theme) => (
          <label key={theme.name} className="tome-option">
            <input type="radio" name="theme" value={theme.name} checked={picked === theme.name} onChange={() => pick(theme)} />
            <span className="tome-option-name">{theme.label}</span>
            {theme.description && <span className="tome-option-text">{theme.description}</span>}
          </label>
        ))}
      </div>
      {changed && (
        <div className="tome-settings-actions">
          <button type="button" className="tome-settings-save" disabled={saving} onClick={save}>
            Save
          </button>
          <button type="button" className="tome-settings-cancel" disabled={saving} onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {error && <Failed error={error} />}
    </section>
  );
}

const START_MODES: { mode: StartMode; name: string; text: string }[] = [
  { mode: "sequence", name: "In sequence", text: "Start runs everything due, one subject after another." },
  { mode: "ask", name: "Ask", text: "Start asks which subject to practise." },
];

function StartSetting({ saved: initial }: { saved: StartMode }) {
  const [start, setStart] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  async function choose(mode: StartMode) {
    const previous = start;
    setStart(mode);
    setSaving(true);
    try {
      setStart((await api.saveSetting("start", mode)).start);
      setError(undefined);
    } catch (failure) {
      setStart(previous);
      setError(errorOf(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="tome-section tome-settings" data-setting="start" aria-labelledby="setting-start">
      <div className="tome-section-head">
        <h3 id="setting-start">Start</h3>
      </div>
      <div className="tome-options" role="radiogroup" aria-labelledby="setting-start">
        {START_MODES.map(({ mode, name, text }) => (
          <label key={mode} className="tome-option">
            <input type="radio" name="start" value={mode} checked={start === mode} disabled={saving} onChange={() => choose(mode)} />
            <span className="tome-option-name">{name}</span>
            <span className="tome-option-text">{text}</span>
          </label>
        ))}
      </div>
      {error && <Failed error={error} />}
    </section>
  );
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

type Direction = "up" | "down";

function SubjectOrder({ initial }: { initial: Subject[] }) {
  const [order, setOrder] = useState(initial);
  const [dragging, setDragging] = useState<string>();
  const [error, setError] = useState<Error>();
  const rows = useRef(new Map<string, HTMLLIElement>());
  const list = useRef<HTMLOListElement>(null);
  const live = useRef(initial);
  const saved = useRef(initial);
  const saves = useRef(0);
  const held = useRef<string>(undefined);
  const refocus = useRef<{ id: string; direction: Direction }>(undefined);

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = undefined;
    const row = rows.current.get(target.id);
    const other: Direction = target.direction === "up" ? "down" : "up";
    const button =
      row?.querySelector<HTMLButtonElement>(`[data-move="${target.direction}"]:not(:disabled)`) ??
      row?.querySelector<HTMLButtonElement>(`[data-move="${other}"]`);
    button?.focus();
  }, [order]);

  function show(next: Subject[]) {
    live.current = next;
    setOrder(next);
  }

  async function save(next: Subject[]) {
    show(next);
    const attempt = ++saves.current;
    try {
      await api.saveSetting("subjects", next.map((subject) => subject.id));
      saved.current = next;
      if (attempt === saves.current) setError(undefined);
    } catch (failure) {
      if (attempt !== saves.current) return;
      show(saved.current);
      setError(errorOf(failure));
    }
  }

  function move(index: number, direction: Direction) {
    const current = live.current;
    const to = direction === "up" ? index - 1 : index + 1;
    refocus.current = { id: current[index]!.id, direction };
    void save(moved(current, index, to));
  }

  function grab(event: PointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0 || !list.current) return;
    event.preventDefault();
    list.current.setPointerCapture(event.pointerId);
    held.current = id;
    setDragging(id);
  }

  function drag(event: PointerEvent<HTMLOListElement>) {
    if (held.current === undefined) return;
    const current = live.current;
    const from = current.findIndex((subject) => subject.id === held.current);
    const to = current.findIndex((subject) => {
      const box = rows.current.get(subject.id)?.getBoundingClientRect();
      return box !== undefined && event.clientY < box.top + box.height / 2;
    });
    const target = to === -1 ? current.length - 1 : to > from ? to - 1 : to;
    if (target !== from) show(moved(current, from, target));
  }

  function drop() {
    if (held.current === undefined) return;
    held.current = undefined;
    setDragging(undefined);
    const current = live.current;
    if (current.some((subject, index) => subject.id !== saved.current[index]?.id)) void save(current);
  }

  return (
    <section className="tome-section tome-settings" data-setting="subjects" aria-labelledby="setting-subjects">
      <div className="tome-section-head">
        <h3 id="setting-subjects">Subject order</h3>
      </div>
      {order.length === 0 ? (
        <p className="tome-hint">No subjects yet.</p>
      ) : (
        <ol
          ref={list}
          className="tome-order"
          aria-labelledby="setting-subjects"
          onPointerMove={drag}
          onPointerUp={drop}
          onPointerCancel={drop}
          onLostPointerCapture={drop}
        >
          {order.map((subject, index) => (
            <li
              key={subject.id}
              ref={(row) => {
                if (row) rows.current.set(subject.id, row);
                else rows.current.delete(subject.id);
              }}
              className="tome-order-row"
              data-subject={subject.id}
              data-dragging={dragging === subject.id ? "" : undefined}
            >
              <span
                className="tome-order-handle"
                aria-hidden="true"
                onPointerDown={(event) => grab(event, subject.id)}
              >
                ⠿
              </span>
              <span className="tome-order-name">{subject.name}</span>
              <button
                type="button"
                className="tome-order-move"
                data-move="up"
                aria-label={`Move ${subject.name} up`}
                disabled={index === 0}
                onClick={() => move(index, "up")}
              >
                ↑
              </button>
              <button
                type="button"
                className="tome-order-move"
                data-move="down"
                aria-label={`Move ${subject.name} down`}
                disabled={index === order.length - 1}
                onClick={() => move(index, "down")}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
      )}
      {error && <Failed error={error} />}
    </section>
  );
}
