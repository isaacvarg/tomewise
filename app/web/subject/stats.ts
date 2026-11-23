import type { ChartSeries, SubjectStats } from "../api.ts";

export const PLOT = { width: 300, height: 100 } as const;

const STEPS = [1, 2, 2.5, 5];

function niceStep(raw: number): number {
  const scale = 10 ** Math.floor(Math.log10(raw));
  return (STEPS.find((step) => step * scale >= raw) ?? 10) * scale;
}

function nextStep(step: number): number {
  return niceStep(step * 1.000001);
}

export interface Scale {
  lo: number;
  hi: number;
}

export function scaleOf(values: number[], { fromZero = false, unit = null }: { fromZero?: boolean; unit?: string | null } = {}): Scale {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const zeroBased = fromZero && min >= 0;
  const bottom = zeroBased ? 0 : min;
  let step = niceStep(max > bottom ? (max - bottom) / 2 : Math.abs(max) / 2 || 1);
  for (;;) {
    let lo = zeroBased ? 0 : Math.floor((max > min ? min : min - step) / step) * step;
    if (min >= 0 && lo < 0) lo = 0;
    let hi = lo + 2 * step;
    if (hi >= max) {
      if (unit === "ratio" && hi > 1) [lo, hi] = [Math.max(0, lo - (hi - 1)), 1];
      return { lo, hi };
    }
    step = nextStep(step);
  }
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export function formatValue(value: number, unit: string | null, scale?: Scale): string {
  const span = scale ? scale.hi - scale.lo : Math.abs(value);
  switch (unit) {
    case "ratio":
      return `${round(value * 100, span < 0.1 ? 1 : 0)}%`;
    case "ms":
      return Math.max(Math.abs(value), scale?.hi ?? 0) >= 1000
        ? `${round(value / 1000, span < 1000 ? 2 : 1)} s`
        : `${round(value, 0)} ms`;
    case null:
      return String(round(value, span < 1 ? 2 : span < 10 ? 1 : 0));
    default:
      return `${round(value, span < 1 ? 2 : span < 10 ? 1 : 0)} ${unit}`;
  }
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes % 60}m`;
}

export function formatPercent(ratio: number | null): string {
  return ratio === null ? "–" : `${Math.round(ratio * 100)}%`;
}

export function totalsOf(stats: SubjectStats): { value: string; label: string }[] {
  const { durationMs, sessions, accuracy } = stats.totals;
  return [
    { value: formatDuration(durationMs), label: "practised" },
    { value: String(sessions), label: sessions === 1 ? "session" : "sessions" },
    { value: formatPercent(accuracy), label: "accuracy, 30 days" },
  ];
}

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const dayLabel = (date: string) => DAY_LABEL.format(new Date(`${date}T00:00:00Z`));

export interface Mark {
  date: string;
  value: number;
  x: number;
  y: number;
}

export interface Bar extends Mark {
  width: number;
  height: number;
  today: boolean;
}

export interface ChartView {
  id: string;
  title: string;
  kind: ChartSeries["kind"];
  meta: string;
  label: string;
  ticks: string[];
  days: string[];
  empty: boolean;
  marks: Mark[];
  bars: Bar[];
  line: string;
}

function dayLabels(series: ChartSeries): string[] {
  const dates = series.points.map((point) => point.date);
  const picks = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
  return picks.map((index) => dayLabel(dates[index]!));
}

function metaOf(series: ChartSeries): string {
  const days = series.points.length;
  return [series.aggregate, `${days} ${days === 1 ? "day" : "days"}`].filter(Boolean).join(" · ");
}

export function chartView(series: ChartSeries): ChartView {
  const { width, height } = PLOT;
  const count = series.points.length;
  const present = series.points.flatMap((point, index) => (point.value === null ? [] : [{ ...point, value: point.value, index }]));
  const base = { id: series.id, title: series.title, kind: series.kind, meta: metaOf(series), days: dayLabels(series) };
  if (present.length === 0) {
    return { ...base, label: `${series.title}: no data`, ticks: [], empty: true, marks: [], bars: [], line: "" };
  }
  const scale = scaleOf(
    present.map((point) => point.value),
    { fromZero: series.kind === "bar", unit: series.unit },
  );
  const yOf = (value: number) => round(height - ((value - scale.lo) / (scale.hi - scale.lo)) * height, 2);
  const slot = width / count;
  const xOf = (index: number) =>
    round(series.kind === "bar" ? index * slot + slot / 2 : count === 1 ? width / 2 : (index / (count - 1)) * width, 2);
  const marks = present.map((point) => ({ date: point.date, value: point.value, x: xOf(point.index), y: yOf(point.value) }));
  const zero = yOf(Math.min(Math.max(0, scale.lo), scale.hi));
  const bars = series.kind === "bar"
    ? marks.map((mark, index) => ({
        ...mark,
        x: round(mark.x - slot * 0.32, 2),
        y: Math.min(mark.y, zero),
        width: round(slot * 0.64, 2),
        height: round(Math.abs(zero - mark.y), 2),
        today: present[index]!.index === count - 1,
      }))
    : [];
  const ticks = [scale.hi, (scale.hi + scale.lo) / 2, scale.lo].map((value) => formatValue(value, series.unit, scale));
  const latest = present.at(-1)!;
  const label = `${series.title}, ${base.meta}: ${formatValue(latest.value, series.unit, scale)} on ${dayLabel(latest.date)}`;
  return {
    ...base,
    label,
    ticks,
    empty: false,
    marks,
    bars,
    line: series.kind === "line" ? marks.map((mark) => `${mark.x},${mark.y}`).join(" ") : "",
  };
}
