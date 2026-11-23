import { useState } from "react";
import { type AssessmentOverrides, type AssessmentSettings, api, type QuizFrequency, type Subject } from "../api.ts";
import { Failed } from "../screen.tsx";

interface Draft {
  enabled: string;
  frequency: string;
  every: string;
  quizLength: string;
  exams: string;
  timed: string;
  minutes: string;
  scoreDisplay: string;
  passMark: string;
}

const onOff = (value: boolean | undefined) => (value === undefined ? "" : value ? "on" : "off");

function toDraft(values: AssessmentOverrides, fallback: AssessmentSettings): Draft {
  const frequency = values.quizFrequency;
  const timed = values.timed;
  const every = typeof frequency === "object" ? frequency : typeof fallback.quizFrequency === "object" ? fallback.quizFrequency : { every: 5 };
  const minutes = typeof timed === "object" ? timed : typeof fallback.timed === "object" ? fallback.timed : { minutes: 20 };
  return {
    enabled: onOff(values.enabled),
    frequency: frequency === undefined ? "" : typeof frequency === "object" ? "every" : frequency,
    every: String(every.every),
    quizLength: values.quizLength === undefined ? "" : String(values.quizLength),
    exams: onOff(values.exams),
    timed: timed === undefined ? "" : timed === false ? "off" : "limit",
    minutes: String(minutes.minutes),
    scoreDisplay: values.scoreDisplay ?? "",
    passMark: values.passMark === undefined ? "" : String(values.passMark),
  };
}

const numberOf = (text: string) => (text.trim() === "" ? undefined : Number(text));

function fromDraft(draft: Draft): AssessmentOverrides {
  const values: AssessmentOverrides = {};
  if (draft.enabled !== "") values.enabled = draft.enabled === "on";
  if (draft.frequency !== "") {
    values.quizFrequency = draft.frequency === "every" ? { every: Number(draft.every) } : (draft.frequency as Exclude<QuizFrequency, object>);
  }
  const quizLength = numberOf(draft.quizLength);
  if (quizLength !== undefined) values.quizLength = quizLength;
  if (draft.exams !== "") values.exams = draft.exams === "on";
  if (draft.timed !== "") values.timed = draft.timed === "off" ? false : { minutes: Number(draft.minutes) };
  if (draft.scoreDisplay !== "") values.scoreDisplay = draft.scoreDisplay as AssessmentSettings["scoreDisplay"];
  const passMark = numberOf(draft.passMark);
  if (passMark !== undefined) values.passMark = passMark;
  return values;
}

function frequencyText(frequency: QuizFrequency): string {
  if (frequency === "weekly") return "weekly";
  if (frequency === "onDemand") return "on demand";
  return `every ${frequency.every} lesson${frequency.every === 1 ? "" : "s"}`;
}

const SCORE_DISPLAYS: { value: AssessmentSettings["scoreDisplay"]; name: string }[] = [
  { value: "number", name: "Number" },
  { value: "pass-fail", name: "Pass or fail" },
  { value: "hidden", name: "Hidden" },
];

const scoreText = (display: AssessmentSettings["scoreDisplay"]) => SCORE_DISPLAYS.find((choice) => choice.value === display)!.name.toLowerCase();

const timedText = (timed: AssessmentSettings["timed"]) => (timed === false ? "off" : `${timed.minutes} min`);

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface FormProps {
  saved: AssessmentOverrides;
  inherited?: AssessmentSettings;
  save: (values: AssessmentOverrides) => Promise<AssessmentOverrides>;
}

function AssessmentForm({ saved: initial, inherited, save }: FormProps) {
  const [saved, setSaved] = useState(initial);
  const fallback = inherited ?? (initial as AssessmentSettings);
  const [draft, setDraft] = useState(() => toDraft(initial, fallback));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  const set = (field: keyof Draft) => (event: { target: { value: string } }) => setDraft({ ...draft, [field]: event.target.value });
  const inherit = (text: string) => inherited && <option value="">Home default ({text})</option>;

  function cancel() {
    setDraft(toDraft(saved, fallback));
    setError(undefined);
  }

  async function submit() {
    setSaving(true);
    try {
      const next = await save(fromDraft(draft));
      setSaved(next);
      setDraft(toDraft(next, fallback));
      setError(undefined);
    } catch (failure) {
      setError(errorOf(failure));
    } finally {
      setSaving(false);
    }
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(toDraft(saved, fallback));
  return (
    <>
      <div className="tome-fields">
        <label className="tome-field">
          <span className="tome-field-name">Quizzes and exams</span>
          <select aria-label="Quizzes and exams" value={draft.enabled} onChange={set("enabled")}>
            {inherit(inherited?.enabled ? "on" : "off")}
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="tome-field">
          <span className="tome-field-name">Quiz frequency</span>
          <select aria-label="Quiz frequency" value={draft.frequency} onChange={set("frequency")}>
            {inherit(inherited ? frequencyText(inherited.quizFrequency) : "")}
            <option value="every">Every few lessons</option>
            <option value="weekly">Weekly</option>
            <option value="onDemand">On demand</option>
          </select>
          {draft.frequency === "every" && (
            <input aria-label="Lessons between quizzes" type="number" min={1} step={1} value={draft.every} onChange={set("every")} />
          )}
        </label>
        <label className="tome-field">
          <span className="tome-field-name">Questions per quiz</span>
          <input
            aria-label="Questions per quiz"
            type="number"
            min={1}
            step={1}
            value={draft.quizLength}
            placeholder={inherited ? String(inherited.quizLength) : undefined}
            onChange={set("quizLength")}
          />
        </label>
        <label className="tome-field">
          <span className="tome-field-name">Exams</span>
          <select aria-label="Exams" value={draft.exams} onChange={set("exams")}>
            {inherit(inherited?.exams ? "on" : "off")}
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="tome-field">
          <span className="tome-field-name">Time limit</span>
          <select aria-label="Time limit" value={draft.timed} onChange={set("timed")}>
            {inherit(inherited ? timedText(inherited.timed) : "")}
            <option value="off">Off</option>
            <option value="limit">Minutes</option>
          </select>
          {draft.timed === "limit" && (
            <input aria-label="Minutes" type="number" min={1} value={draft.minutes} onChange={set("minutes")} />
          )}
        </label>
        <label className="tome-field">
          <span className="tome-field-name">Score</span>
          <select aria-label="Score" value={draft.scoreDisplay} onChange={set("scoreDisplay")}>
            {inherit(inherited ? scoreText(inherited.scoreDisplay) : "")}
            {SCORE_DISPLAYS.map(({ value, name }) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="tome-field">
          <span className="tome-field-name">Pass mark (%)</span>
          <input
            aria-label="Pass mark"
            type="number"
            min={0}
            max={100}
            value={draft.passMark}
            placeholder={inherited ? String(inherited.passMark) : undefined}
            onChange={set("passMark")}
          />
        </label>
      </div>
      {changed && (
        <div className="tome-settings-actions">
          <button type="button" className="tome-settings-save" disabled={saving} onClick={submit}>
            Save
          </button>
          <button type="button" className="tome-settings-cancel" disabled={saving} onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {error && <Failed error={error} />}
    </>
  );
}

export function AssessmentSettingsSections({
  defaults: initial,
  overrides,
  subjects,
}: {
  defaults: AssessmentSettings;
  overrides: Record<string, AssessmentOverrides>;
  subjects: Subject[];
}) {
  const [defaults, setDefaults] = useState(initial);

  async function saveDefaults(values: AssessmentOverrides) {
    const next = (await api.saveSetting("assessments", values)).assessments;
    setDefaults(next);
    return next;
  }

  return (
    <>
      <section className="tome-section tome-settings" data-setting="assessments" aria-labelledby="setting-assessments">
        <div className="tome-section-head">
          <h3 id="setting-assessments">Quizzes and exams</h3>
        </div>
        <p className="tome-hint">Defaults for every subject.</p>
        <AssessmentForm saved={initial} save={saveDefaults} />
      </section>
      {subjects.length > 0 && (
        <section className="tome-section tome-settings" data-setting="subject-assessments" aria-labelledby="setting-subject-assessments">
          <div className="tome-section-head">
            <h3 id="setting-subject-assessments">Quizzes and exams by subject</h3>
          </div>
          {subjects.map((subject) => (
            <div key={subject.id} className="tome-subject-settings" data-subject={subject.id} role="group" aria-label={subject.name}>
              <h4>{subject.name}</h4>
              <AssessmentForm
                saved={overrides[subject.id] ?? {}}
                inherited={defaults}
                save={async (values) => (await api.saveSubjectAssessments(subject.id, values)).subjectAssessments[subject.id] ?? {}}
              />
            </div>
          ))}
        </section>
      )}
    </>
  );
}
