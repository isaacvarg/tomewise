import { api, type ChartSeries, type SubjectStats } from "../api.ts";
import { useLoad } from "../load.ts";
import { Failed } from "../screen.tsx";
import { type ChartView, chartView, PLOT, totalsOf } from "./stats.ts";

export function Stats({ subject }: { subject: string }) {
  const loaded = useLoad(() => api.stats(subject), [subject], { refetchOn: ["content", "events"] });
  if (loaded.state === "loading") {
    return (
      <p className="tome-hint" aria-busy="true">
        Loading…
      </p>
    );
  }
  if (loaded.state === "error") return <Failed error={loaded.error} />;
  return <StatsPanel stats={loaded.data} />;
}

export function StatsPanel({ stats }: { stats: SubjectStats }) {
  return (
    <>
      <ul className="tome-totals" aria-label="Totals">
        {totalsOf(stats).map((total) => (
          <li key={total.label}>
            <b>{total.value}</b>
            <span>{total.label}</span>
          </li>
        ))}
      </ul>
      {stats.charts.length === 0 ? (
        <p className="tome-hint">No charts yet. Ask your agent for charts of what you want to track.</p>
      ) : (
        <section className="tome-charts" aria-label="Charts">
          {stats.charts.map((series) => (
            <Chart key={series.id} series={series} />
          ))}
        </section>
      )}
    </>
  );
}

const GRID = [0, PLOT.height / 2, PLOT.height];

export function Chart({ series }: { series: ChartSeries }) {
  const view = chartView(series);
  return (
    <figure className="tome-chart" data-chart={view.id} data-kind={view.kind} data-empty={view.empty ? "" : undefined}>
      <div className="tome-section-head">
        <h3>{view.title}</h3>
        <span className="tome-meta">{view.meta}</span>
      </div>
      {view.empty ? (
        <p className="tome-hint">{series.points.length === 1 ? "No data today yet." : `No data in these ${series.points.length} days yet.`}</p>
      ) : (
        <div className="tome-chart-plot">
          <div className="tome-chart-y" aria-hidden="true">
            {view.ticks.map((tick, index) => (
              <span key={index}>{tick}</span>
            ))}
          </div>
          <Plot view={view} />
          <div className="tome-chart-x" aria-hidden="true">
            {view.days.map((day, index) => (
              <span key={index}>{day}</span>
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}

function Plot({ view }: { view: ChartView }) {
  const { width, height } = PLOT;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={view.label}>
      {GRID.map((y) => (
        <line key={y} className="tome-chart-grid" x1={0} x2={width} y1={y} y2={y} vectorEffect="non-scaling-stroke" />
      ))}
      {view.kind === "line" ? (
        <>
          <polygon className="tome-chart-area" points={`${view.marks[0]!.x},${height} ${view.line} ${view.marks.at(-1)!.x},${height}`} />
          <polyline className="tome-chart-line" points={view.line} vectorEffect="non-scaling-stroke" />
          {view.marks.map((mark) => (
            <line
              key={mark.date}
              className="tome-chart-dot"
              x1={mark.x}
              x2={mark.x}
              y1={mark.y}
              y2={mark.y}
              vectorEffect="non-scaling-stroke"
              data-date={mark.date}
              data-value={mark.value}
            />
          ))}
        </>
      ) : (
        view.bars.map((bar) => (
          <rect
            key={bar.date}
            className="tome-chart-bar"
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            data-date={bar.date}
            data-value={bar.value}
            data-today={bar.today ? "" : undefined}
          />
        ))
      )}
    </svg>
  );
}
