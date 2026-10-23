/**
 * The daily bar trend (RQS-06), in Plotly. `RequestsView` loads this module
 * lazily, as it loads the zoomable trend, so Plotly downloads only when the
 * tab draws.
 */
import type Plotly from "plotly.js-dist-min"
import type { RequestTrendResponse } from "@/client"
import type { RequestsFilter } from "@/lib/requests/breakdown"
import { type Bar, dailyBars } from "@/lib/requests/trend"
import { Swatch } from "./parts"
import { type Colors, Plot, useColors } from "./plotly"

const LAYERS = [
  { key: "charged", label: "Charged", color: "line" },
  { key: "uncharged", label: "Uncharged", color: "uncharged" },
  { key: "ledger", label: "Before recording", color: "ledger" },
] as const

type Layer = (typeof LAYERS)[number]

/** The swatch beside a layer's name; the ledger's days hatched, as on the bars. */
const SWATCH: Record<Layer["key"], string> = {
  charged: "var(--layer-charged)",
  uncharged: "var(--layer-uncharged)",
  ledger:
    "repeating-linear-gradient(45deg, var(--viz-axis) 0 2px, transparent 2px 4px)",
}

/** A layer's bars: only the days with some of it, so no empty sliver is drawn. */
function trace(bars: Bar[], l: Layer, c: Colors): Partial<Plotly.BarData> {
  const some = bars.filter((b) => b[l.key] > 0)
  return {
    type: "bar",
    name: l.label,
    x: some.map((b) => b.x),
    y: some.map((b) => b[l.key]),
    marker: {
      color: c[l.color],
      // The ledger's days before recording have no outcome: hatched (RQS-16).
      ...(l.key === "ledger" && {
        pattern: { shape: "/", fgcolor: c.surface, size: 6 },
      }),
    },
    hovertemplate: `%{x}: %{y:,.0f}<extra>${l.label}</extra>`,
  }
}

/** About this many labels on the x axis, whatever the range. */
const TICKS = 8

/**
 * The bars' look: the app's ink on a transparent ground, stacked, no legend.
 * Every day on the axis, in order, a day with nothing included; a day's
 * label drops its year.
 */
function layout(c: Colors, bars: Bar[], day: boolean): Partial<Plotly.Layout> {
  const axis = { gridcolor: c.grid, linecolor: c.grid, zeroline: false }
  const labels = bars.map((b) => b.x)
  const every = Math.ceil(labels.length / TICKS)
  const ticks = labels.filter((_, i) => i % every === 0)
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: c.axis, size: 10, family: "inherit" },
    margin: { l: 44, r: 12, t: 4, b: 24 },
    height: 120,
    barmode: "stack",
    bargap: 0.1,
    showlegend: false,
    hovermode: "x",
    dragmode: false,
    xaxis: {
      ...axis,
      type: "category",
      categoryorder: "array",
      categoryarray: labels,
      range: [-0.5, labels.length - 0.5],
      tickvals: ticks,
      ticktext: ticks.map((x) => (day ? x : x.slice(5))),
      showgrid: false,
      fixedrange: true,
    },
    yaxis: { ...axis, tickformat: "~s", fixedrange: true },
    hoverlabel: { bgcolor: c.surface, bordercolor: c.grid },
    ...(day ? {} : { clickmode: "event" }),
  }
}

/**
 * The range's Requests per UTC day, Charged and Uncharged stacked, and the
 * ledger's days before recording hatched on top; per hour when the range is
 * one day. Clicking a day narrows the whole tab to it. Hidden kinds and
 * outcomes add nothing.
 */
export default function DailyBars({
  trend,
  range,
  filter,
  onDay,
}: {
  trend: RequestTrendResponse
  range: { start: number; end: number }
  filter: RequestsFilter
  /** A day was clicked: its midnight, epoch ms. */
  onDay: (start: number) => void
}) {
  const c = useColors()
  const { grain, bars, dailyOnly } = dailyBars(
    trend.buckets,
    range,
    filter.hiddenKinds,
    filter.hiddenOutcomes,
  )
  const day =
    grain === "hour" && new Date(range.start).toISOString().slice(0, 10)
  const layers = LAYERS.filter((l) =>
    l.key === "ledger"
      ? bars.some((b) => b.ledger > 0)
      : filter.charged === "all" || filter.charged === l.key,
  )
  return (
    <section
      data-testid="requests-daily-bars"
      className="rounded-md border border-app-ink/10 bg-app-card p-2"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 px-1 text-[11px] text-app-ink/60">
        <span data-testid="requests-daily-title">
          {day
            ? `Requests per hour on ${day} (UTC)`
            : "Requests per day (UTC). Click a day to narrow everything to it."}
        </span>
        <span className="ml-auto" />
        {layers.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5 px-1">
            <Swatch color={SWATCH[l.key]} />
            {l.label}
          </span>
        ))}
      </div>
      {dailyOnly ? (
        <p
          data-testid="requests-daily-only"
          className="px-1 py-6 text-center text-[12px] text-app-ink/50"
        >
          Hourly totals are kept for {trend.hourlyDays} days, so {day} has its
          daily total only.
        </p>
      ) : (
        c && (
          <Plot
            style={{
              width: "100%",
              height: 120,
              cursor: day ? "auto" : "pointer",
            }}
            useResizeHandler
            config={{ displayModeBar: false, responsive: true }}
            data={layers.map((l) => trace(bars, l, c))}
            layout={layout(c, bars, !!day)}
            onClick={(e) => {
              const bar = bars.find((b) => b.x === e.points[0]?.x)
              if (!day && bar) onDay(bar.at)
            }}
          />
        )
      )}
    </section>
  )
}
