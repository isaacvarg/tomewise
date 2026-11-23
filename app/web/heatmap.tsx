import type { ReactNode } from "react";
import { type HeatCell, NARROW_WEEKS, type WeekStart, weekdayLetters } from "./home/model.ts";

export interface HeatmapProps {
  cells: HeatCell[];
  weekStart: WeekStart;
  label: string;
  meta?: ReactNode;
}

export function Heatmap({ cells, weekStart, label, meta }: HeatmapProps) {
  return (
    <section className="tome-section tome-activity" aria-label="Activity">
      <div className="tome-section-head">
        <h3>Activity</h3>
        <span className="tome-meta">
          <span className="tome-meta-narrow">Last {NARROW_WEEKS} weeks</span>
          <span className="tome-meta-wide">Last 12 months</span>
          {meta}
        </span>
      </div>
      <div className="tome-heatmap-wrap">
        <div className="tome-heat-days" aria-hidden="true">
          {weekdayLetters(weekStart).map((letter, index) => (
            <span key={index}>{letter}</span>
          ))}
        </div>
        <div className="tome-heatmap" role="img" aria-label={label}>
          {cells.map((cell) => (
            <i
              key={cell.date}
              className="tome-cell"
              data-date={cell.date}
              data-level={cell.level > 0 ? cell.level : undefined}
              data-today={cell.today ? "" : undefined}
              data-future={cell.future ? "" : undefined}
              data-old={cell.old ? "" : undefined}
            />
          ))}
        </div>
      </div>
      <div className="tome-heat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className="tome-cell" data-level={level > 0 ? level : undefined} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
