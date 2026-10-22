// PROTOTYPE (request-stats): the trend in Plotly, as detailed as the
// tiers keep: daily totals for every day, hourly for the last HOURLY_DAYS, and 5-minute
// buckets from each Request for the last REQUEST_DAYS. Plotly brings the zoom, pan,
// range slider, range buttons, unified hover and clickable legends. `?trend=`. Never merge.
import { Maximize2, Minimize2 } from "lucide-react"
import Plotly from "plotly.js-dist-min"
import { useEffect, useState } from "react"
import createPlotlyComponentModule from "react-plotly.js/factory"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import type { TimeBound } from "@/lib/time-bound/bound"
import {
  applyFilter,
  type Fact,
  type Filter,
  fmt,
  HOURLY_DAYS,
  KINDS,
  type Kind,
  OUTCOMES,
  type Outcome,
  REQUEST_DAYS,
} from "./data"
import {
  KIND_COLOR,
  OUTCOME_COLOR,
  OutcomeToggles,
  toggleIn,
  useResolvedColors,
} from "./shared"

// The factory is CommonJS; Vite hands it over either bare or as `{ default }`.
const createPlotlyComponent =
  (
    createPlotlyComponentModule as unknown as {
      default?: typeof createPlotlyComponentModule
    }
  ).default ?? createPlotlyComponentModule
const Plot = createPlotlyComponent(Plotly)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const FINE = 5 * MIN

export interface TrendProps {
  dayFacts: Fact[]
  hourFacts: Fact[]
  fineFacts: Fact[]
  filter: Filter
  days: string[]
  onBound: (bound: TimeBound) => void
  /** Outcomes and kinds switched off, shared with the tables below. */
  hidden: Set<Outcome>
  onHidden: React.Dispatch<React.SetStateAction<Set<Outcome>>>
  hiddenKinds: Set<Kind>
  onHiddenKinds: React.Dispatch<React.SetStateAction<Set<Kind>>>
}

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`)
/**
 * Plotly draws a timestamp in the browser's time zone but a date string with no zone as
 * written. So every time goes to Plotly as a zoneless UTC string, and the axis, the
 * hover and the ranges it hands back all read in UTC, like the rest of the tab.
 */
const toPlotly = (ms: number) => new Date(ms).toISOString().slice(0, 23)
const fromPlotly = (v: string | number) =>
  typeof v === "number" ? v : Date.parse(`${v.replace(" ", "T")}Z`)

// ---- Colours: Plotly draws on canvas and SVG it styles itself, so it gets hex ---------

const COLOR_VARS = {
  ...Object.fromEntries(KINDS.map((k) => [k.id, KIND_COLOR[k.id]])),
  ...Object.fromEntries(OUTCOMES.map((o) => [o.id, OUTCOME_COLOR[o.id]])),
  ink: "var(--viz-ink)",
  axis: "var(--viz-axis)",
  grid: "var(--viz-grid)",
  surface: "var(--viz-surface)",
  heat: "var(--chart-1)",
  band: "var(--account-4)",
} as Record<string, string>

function rgba(hex: string, alpha: number) {
  const h = hex.replace("#", "")
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** `a` mixed into `b`: an opaque tint, so the tier bands behind do not shift its hue. */
function mix(a: string, b: string, share: number) {
  const ch = (hex: string) => {
    const h = hex.replace("#", "")
    const n = Number.parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [x, y] = [ch(a), ch(b)]
  return `rgb(${x.map((v, i) => Math.round(v * share + y[i] * (1 - share))).join(",")})`
}

/** The look every chart here shares: transparent, the app's ink, quiet grid. */
function baseLayout(c: Record<string, string>) {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: c.ink, size: 11, family: "inherit" },
    margin: { l: 48, r: 12, t: 30, b: 28 },
    hoverlabel: {
      bgcolor: c.surface,
      bordercolor: c.grid,
      font: { color: c.ink, size: 11 },
    },
    legend: { orientation: "h", x: 0, y: 1.14, font: { size: 11 } },
    xaxis: { gridcolor: c.grid, linecolor: c.grid, zeroline: false },
    yaxis: {
      gridcolor: c.grid,
      linecolor: c.grid,
      zeroline: false,
      tickformat: "~s",
      rangemode: "tozero",
    },
  }
}
const CONFIG = {
  displaylogo: false,
  responsive: true,
  scrollZoom: true,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
}

/** Where each tier starts: hours from HOURLY_DAYS back, 5-minute buckets from REQUEST_DAYS back. */
function tierEdges(days: string[], fineFacts: Fact[]) {
  const hourlyFrom = dayStart(days[Math.max(0, days.length - HOURLY_DAYS)])
  const fineFrom = fineFacts.reduce(
    (m, x) => Math.min(m, x.at ?? m),
    Date.now() - REQUEST_DAYS * DAY,
  )
  return { hourlyFrom, fineFrom: Math.ceil(fineFrom / HOUR) * HOUR }
}

/** The three tiers as bands behind a date axis, each named at its top. */
function tierShapes(
  c: Record<string, string>,
  lo: number,
  hi: number,
  hourlyFrom: number,
  fineFrom: number,
  yref = "paper",
) {
  const bands = [
    {
      x0: lo,
      x1: Math.min(hourlyFrom, hi),
      label: "daily totals",
      fill: "rgba(0,0,0,0)",
    },
    {
      x0: Math.max(hourlyFrom, lo),
      x1: Math.min(fineFrom, hi),
      label: "hourly totals",
      fill: rgba(c.grid, 0.35),
    },
    {
      x0: Math.max(fineFrom, lo),
      x1: hi,
      label: "each Request",
      fill: rgba(c.band, 0.16),
    },
  ].filter((b) => b.x1 > b.x0)
  return {
    shapes: bands.map((b) => ({
      type: "rect",
      xref: "x",
      yref,
      x0: toPlotly(b.x0),
      x1: toPlotly(b.x1),
      y0: 0,
      y1: 1,
      fillcolor: b.fill,
      line: { width: 0 },
      layer: "below",
    })),
    annotations: bands
      .filter((b) => (b.x1 - b.x0) / (hi - lo) > 0.08)
      .map((b) => ({
        xref: "x",
        yref: "paper",
        x: toPlotly(b.x0),
        y: 1,
        xanchor: "left",
        yanchor: "top",
        text: b.label,
        showarrow: false,
        font: { size: 9, color: c.axis },
      })),
  }
}

/**
 * One series from three grains: whole days before the hourly tier, hours until the
 * per-Request tier, 5-minute buckets after. Each point is a rate, Requests per hour, so
 * a day and five minutes can share an axis; `n` keeps the bucket's own count.
 */
function multiResolution(p: TrendProps) {
  const whole = { ...p.filter, from: p.days[0], to: p.days[p.days.length - 1] }
  const lo = p.filter.start
  const hi = p.filter.end
  const { hourlyFrom, fineFrom } = tierEdges(p.days, p.fineFacts)
  const points = new Map<number, Record<string, number>>()
  const put = (t: number, span: number, x: Fact) => {
    // A bucket the range's edge cuts stays: its Requests are already cut to the part inside.
    if (t + span <= lo || t >= hi) return
    const pt = points.get(t) ?? { t, span, n: 0 }
    // Every way the trend can split a bucket: in all, by kind, by outcome, by both.
    for (const k of ["all", x.kind, x.outcome, `${x.kind}:${x.outcome}`])
      pt[k] = (pt[k] ?? 0) + (x.requests * HOUR) / span
    pt.n += x.requests
    points.set(t, pt)
  }
  for (const x of applyFilter(p.dayFacts, whole))
    if (dayStart(x.day) < hourlyFrom) put(dayStart(x.day), DAY, x)
  for (const x of applyFilter(p.hourFacts, whole)) {
    const t = dayStart(x.day) + (x.hour ?? 0) * HOUR
    if (t >= hourlyFrom && t < fineFrom) put(t, HOUR, x)
  }
  for (const x of applyFilter(p.fineFacts, whole))
    if (x.at !== undefined && x.at >= fineFrom) put(x.at, FINE, x)
  const sorted = [...points.values()].sort((a, b) => a.t - b.t)
  return { points: sorted, lo, hi, hourlyFrom, fineFrom }
}

/** The bucket sizes the trend steps through as the zoom changes, UTC-aligned. */
const BUCKETS = [
  FINE,
  15 * MIN,
  30 * MIN,
  HOUR,
  2 * HOUR,
  4 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
]
/** Buckets across the visible range: about one per 3 to 4 px of the plot. */
const TARGET = 220

/**
 * The stored buckets re-summed into the finest size that keeps about TARGET of them in
 * view. Sums, never averages, so each bucket's hover is its exact count; a stretch kept
 * coarser than the size (daily totals) stays at its own grain.
 */
function rebucket(points: Record<string, number>[], from: number, to: number) {
  const size = BUCKETS.find((b) => (to - from) / b <= TARGET) ?? DAY
  const out = new Map<number, Record<string, number>>()
  for (const pt of points) {
    const span = Math.max(size, pt.span)
    const t = Math.floor(pt.t / span) * span
    const b = out.get(t) ?? { t, span, n: 0 }
    // A rate per hour over pt.span becomes the same Requests' rate over the wider span.
    for (const [k, v] of Object.entries(pt))
      if (k !== "t" && k !== "span" && k !== "n")
        b[k] = (b[k] ?? 0) + (v * pt.span) / span
    b.n += pt.n
    out.set(t, b)
  }
  return { size, points: [...out.values()].sort((a, b) => a.t - b.t) }
}

const grainOf = (span: number) =>
  span >= DAY
    ? "daily total"
    : span === FINE
      ? "5-minute total, from each Request"
      : span < HOUR
        ? `${span / MIN}-minute total`
        : span === HOUR
          ? "hourly total"
          : `${span / HOUR}-hour total`
const utc = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})
/** Above this many times its 99th percentile, a row's tallest bucket stops setting its scale. */
const SPIKE = 1.5

const frame = "space-y-1.5 rounded-md border border-app-ink/10 bg-app-card p-2"
const head =
  "flex flex-wrap items-center gap-2 px-1 text-[11px] text-app-ink/60"
const smallButton =
  "rounded border border-app-ink/20 px-1.5 hover:bg-app-ink/10"

/**
 * Full screen without a remount: the same frame goes fixed over the page, so Plotly's
 * zoom and the visible range carry over. Escape leaves it.
 */
function useFullScreen() {
  const [full, setFull] = useState(false)
  useEffect(() => {
    // Plotly's resize handler listens to the window, which does not resize here.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")))
    if (!full) return
    const leave = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setFull(false)
    }
    window.addEventListener("keydown", leave, true)
    return () => window.removeEventListener("keydown", leave, true)
  }, [full])
  const Icon = full ? Minimize2 : Maximize2
  return {
    full,
    frame: full
      ? "req-proto fixed inset-3 z-[100000] flex flex-col gap-1.5 rounded-md border border-app-ink/20 bg-app-card p-3 shadow-2xl"
      : frame,
    button: (
      <button
        type="button"
        className={`${smallButton} py-0.5`}
        aria-label={
          full ? "Leave the trend's full screen" : "Trend full screen"
        }
        title={full ? "Leave full screen (Esc)" : "Watch the trend full screen"}
        onClick={() => setFull(!full)}
      >
        <Icon size={12} />
      </button>
    ),
  }
}

/**
 * A kind's three outcomes as steps of its colour toward the chart's surface: Useful the
 * full colour, Idle about half, Wasted under a third, opaque so nothing behind blends in, with a hairline
 * in the surface colour between layers. The hue says which kind; the step says what came
 * of it. (Dots and hatching shimmered on thin spikes; translucent tints were too close.)
 */
const STEP: Record<Outcome, number> = { useful: 1, idle: 0.55, wasted: 0.3 }
function statusFill(c: Record<string, string>, kind: string, outcome: Outcome) {
  return { fillcolor: mix(c[kind], c.surface, STEP[outcome]) }
}

/** The chart's shade for each outcome, in the ink: the step is the key, the hue belongs to the kind. */
const SHADE_KEY: Record<Outcome, string> = {
  useful: "var(--viz-ink)",
  idle: "color-mix(in srgb, var(--viz-ink) 55%, var(--viz-surface))",
  wasted: "color-mix(in srgb, var(--viz-ink) 30%, var(--viz-surface))",
}

// ---- One trend: kind and outcome each merged, stacked, or split into rows ---------------

type Split = "off" | "stacked" | "separate"
interface Splits {
  kind: Split
  outcome: Split
}

/** The four switches: whether kinds (and outcomes) are told apart, and if so, stacked in one chart or a row each. */
function SplitControls({
  splits,
  onSplits,
}: {
  splits: Splits
  onSplits: (s: Splits) => void
}) {
  const dimension = (d: keyof Splits, plural: string) => {
    const on = splits[d] !== "off"
    return (
      <span className="flex items-center gap-1">
        <BarToggle
          on={on}
          label={`Separate by ${d}`}
          title={
            on ? `Merge the ${plural} into one` : `Tell the ${plural} apart`
          }
          onClick={() => onSplits({ ...splits, [d]: on ? "off" : "stacked" })}
        />
        <TgInlineChoice<Split>
          aria-label={`${plural} stacked or separate`}
          options={[
            { value: "stacked", label: "Stacked", disabled: !on },
            { value: "separate", label: "Separate", disabled: !on },
          ]}
          value={on ? splits[d] : "off"}
          onChange={(v) => onSplits({ ...splits, [d]: v })}
        />
      </span>
    )
  }
  return (
    <>
      {dimension("kind", "kinds")}
      {dimension("outcome", "outcomes")}
    </>
  )
}

interface Part {
  kind?: Kind
  outcome?: Outcome
}
const KIND_LABELS = Object.fromEntries(
  KINDS.map((k) => [k.id, k.label]),
) as Record<Kind, string>
const OUTCOME_LABELS = Object.fromEntries(
  OUTCOMES.map((o) => [o.id, o.label]),
) as Record<Outcome, string>

/** The parts one Split gives a dimension in one place: every value where it applies, else one merged part. */
function product(kind: boolean, outcome: boolean): Part[] {
  const kinds: (Kind | undefined)[] = kind
    ? KINDS.map((k) => k.id)
    : [undefined]
  const outcomes: (Outcome | undefined)[] = outcome
    ? OUTCOMES.map((o) => o.id)
    : [undefined]
  return kinds.flatMap((k) => outcomes.map((o) => ({ kind: k, outcome: o })))
}
const keyOf = (p: Part) =>
  p.kind && p.outcome
    ? `${p.kind}:${p.outcome}`
    : (p.kind ?? p.outcome ?? "all")
const labelOf = (p: Part) =>
  [p.kind && KIND_LABELS[p.kind], p.outcome && OUTCOME_LABELS[p.outcome]]
    .filter(Boolean)
    .join(" · ") || "All Requests"

/** A series' fill: a kind keeps its hue and an outcome its tint; an outcome alone takes its own colour. */
function fillOf(c: Record<string, string>, p: Part) {
  if (p.kind && p.outcome) return statusFill(c, p.kind, p.outcome)
  if (p.kind) return { fillcolor: rgba(c[p.kind], 0.8) }
  if (p.outcome) return { fillcolor: rgba(c[p.outcome], 0.8) }
  return { fillcolor: rgba(c.heat, 0.8) }
}

/**
 * The trend. A separated dimension is either stacked inside a chart or given a row per
 * value; with both in rows there is a row per kind and outcome. Rows share the x axis, so
 * a zoom anywhere moves every row, and each row has its own scale.
 */
export function Trend(p: TrendProps) {
  const [splits, setSplits] = useState<Splits>({
    kind: "stacked",
    outcome: "stacked",
  })
  const [visible, setVisible] = useState<[number, number] | null>(null)
  // The legend toggles the tab's own switches, the kind table's Show boxes and the outcome
  // chips, not a state of Plotly's: the scale (computed here) and the tables follow it.
  const { hidden, onHidden: setHidden, hiddenKinds, onHiddenKinds } = p
  const fs = useFullScreen()
  const { ref, colors: c } = useResolvedColors(COLOR_VARS)
  const stored = multiResolution(p)
  const { lo, hi, hourlyFrom, fineFrom } = stored
  const [from, to] = visible ?? [lo, hi]
  const { size, points: buckets } = rebucket(stored.points, from, to)
  // A gentle curve once buckets are wide; steps at the finest, where a curve would claim
  // the rate moved smoothly inside five minutes. A curve passes through each bucket's
  // middle, a step holds from its start to its end.
  const smooth = size >= 30 * MIN
  const last = buckets.at(-1)
  const points =
    smooth || !last
      ? buckets
      : [...buckets, { ...last, t: last.t + last.span, n: 0 }]
  const x = points.map((pt) => (smooth ? pt.t + pt.span / 2 : pt.t))
  const xPlot = x.map(toPlotly)
  // A part's rate in a bucket, leaving out the kinds and outcomes switched off, also
  // where they are merged.
  const valueOf = (pt: Record<string, number>, part: Part) => {
    let sum = 0
    for (const k of part.kind ? [part.kind] : KINDS.map((x) => x.id))
      for (const o of part.outcome ? [part.outcome] : OUTCOMES.map((x) => x.id))
        if (!hiddenKinds.has(k) && !hidden.has(o)) sum += pt[`${k}:${o}`] ?? 0
    return sum
  }
  // The dimension the legend lists: its hidden values stay listed, greyed, to show again.
  const legendDim: keyof Part | null =
    splits.kind === "stacked"
      ? "kind"
      : splits.outcome === "stacked"
        ? "outcome"
        : null
  const hiddenIn = (s: Part, d: keyof Part) =>
    d === "kind"
      ? !!s.kind && hiddenKinds.has(s.kind)
      : !!s.outcome && hidden.has(s.outcome)
  const off = (s: Part) => !!legendDim && hiddenIn(s, legendDim)
  const custom = points.map((pt) => [
    grainOf(pt.span),
    // The bucket's own count of the outcomes shown.
    fmt(Math.round((valueOf(pt, {}) * pt.span) / HOUR)),
    `${utc.format(pt.t)} to ${utc.format(pt.t + pt.span)} UTC`,
  ])
  // A series with Requests, counted before switches, so a hidden legend entry stays listed;
  // one hidden outside the legend's dimension (or a hidden row) leaves the chart.
  const has = (part: Part) =>
    points.some((pt) => (pt[keyOf(part)] ?? 0) > 0) &&
    (["kind", "outcome"] as const).every(
      (d) => d === legendDim || !hiddenIn(part, d),
    )
  const stack = product(splits.kind === "stacked", splits.outcome === "stacked")
  const rows = product(
    splits.kind === "separate",
    splits.outcome === "separate",
  )
    .map((r) => ({
      row: r,
      series: stack
        .map((s) => ({
          kind: s.kind ?? r.kind,
          outcome: s.outcome ?? r.outcome,
        }))
        .filter(has),
    }))
    .filter((r) => r.series.length > 0)
  const n = rows.length
  // Rows stacked top down, each its own y axis on the one shared x axis.
  const gap = n > 6 ? 0.012 : 0.025
  const rowHeight = (1 - gap * (n - 1)) / n
  const domain = (i: number) => {
    const top = 1 - i * (rowHeight + gap)
    return [Math.max(0, top - rowHeight), top]
  }
  // One legend entry per stacked value, named by its id; it hides that value everywhere.
  const groupOf = (s: Part) => (legendDim === "kind" ? s.kind : s.outcome) ?? ""
  const legend = stack.length > 1
  // In the layout too: Plotly measures its box only on a window resize, not when the rows change.
  const height = n === 1 ? 340 : (n > 6 ? 70 : 110) * n + 130
  const tiers = c
    ? tierShapes(c, lo, hi, hourlyFrom, fineFrom)
    : { shapes: [], annotations: [] }
  // Row names level, left of the ticks: a rotated axis title runs into its neighbours on thin rows.
  const rowNames =
    n > 1
      ? rows.map(({ row }, i) => ({
          xref: "paper",
          yref: "paper",
          x: 0,
          y: (domain(i)[0] + domain(i)[1]) / 2,
          xanchor: "right",
          xshift: -34,
          text: labelOf(row),
          showarrow: false,
          font: { size: 10, color: c?.axis },
        }))
      : []
  const nameWidth = Math.max(0, ...rowNames.map((a) => a.text.length)) * 6
  // Each row's scale from its visible buckets, so a burst out of view or one burst in it
  // does not flatten the rest.
  // Taller buckets reach the top and carry a notch whose hover gives the real total.
  const caps = rows.map(({ series }) => {
    const totals = points.map((pt) =>
      series.reduce((sum, s) => sum + valueOf(pt, s), 0),
    )
    const seen = totals
      .filter((_, k) => x[k] >= from && x[k] <= to)
      .sort((a, b) => a - b)
    const p99 = seen[Math.floor(0.99 * (seen.length - 1))] ?? 0
    const top = seen.at(-1) ?? 0
    const cap = p99 > 0 && top > SPIKE * p99 ? p99 * 1.15 : null
    // Plotly's autorange reads every point, in view or not; the scale here reads only the view.
    // An empty view (a range button can land past the last bucket) stays flat, not the whole data's scale.
    return { totals, cap, range: [0, cap ?? (top > 0 ? top * 1.05 : 1)] }
  })
  const shown = new Set<string>()
  return (
    <div ref={ref} className={fs.frame}>
      <div className={head}>
        <span>
          Requests per hour. Buckets narrow as you zoom in, down to 5 minutes
          for the last week; hover gives each bucket's exact count. Drag or
          scroll to zoom, the slider to pan, double-click to reset.
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {visible && (
            <button
              type="button"
              className={smallButton}
              onClick={() =>
                p.onBound({
                  mode: "fixed",
                  start: Math.floor(visible[0] / MIN) * MIN,
                  end: Math.ceil(visible[1] / MIN) * MIN,
                })
              }
            >
              Use the visible range
            </button>
          )}
          <SplitControls splits={splits} onSplits={setSplits} />
          {fs.button}
        </span>
      </div>
      <div className="px-1">
        <OutcomeToggles
          hidden={hidden}
          onHidden={setHidden}
          swatch={
            splits.kind !== "off" && splits.outcome !== "off"
              ? SHADE_KEY
              : undefined
          }
        />
      </div>
      {c && (
        <Plot
          style={{
            width: "100%",
            height: fs.full ? "auto" : height,
          }}
          className={fs.full ? "min-h-0 flex-1" : undefined}
          useResizeHandler
          config={CONFIG}
          data={rows.flatMap(({ series }, i) => [
            ...series.map((s, j) => {
              const group = groupOf(s)
              const first = legend && !shown.has(group)
              shown.add(group)
              return {
                type: "scatter",
                mode: "lines",
                name: legend
                  ? labelOf(
                      legendDim === "kind"
                        ? { kind: s.kind }
                        : { outcome: s.outcome },
                    )
                  : labelOf(s),
                legendgroup: group,
                showlegend: first,
                visible: off(s) ? "legendonly" : true,
                x: xPlot,
                y: points.map((pt) => valueOf(pt, s)),
                yaxis: i === 0 ? "y" : `y${i + 1}`,
                customdata: custom,
                stackgroup: `row${i}`,
                // Fills only: a line on top of a stack draws the top series' colour over the rest.
                // A hairline in the surface colour between layers, never the series' own colour:
                // that would draw the top series over everything under it.
                line: {
                  shape: smooth ? "spline" : "hv",
                  smoothing: 0.6,
                  width: s.outcome && s.kind ? 0.75 : 0,
                  color: c.surface,
                },
                ...fillOf(c, s),
                // The bucket's span, grain and count once, on the first series.
                hovertemplate:
                  i === 0 && j === 0
                    ? `%{customdata[2]}<br>%{customdata[0]} · %{customdata[1]} Requests<br>%{y:,.0f}/h<extra>${labelOf(s)}</extra>`
                    : `%{y:,.0f}/h<extra>${labelOf(s)}</extra>`,
              }
            }),
            ...(caps[i].cap === null
              ? []
              : [
                  {
                    type: "scatter",
                    mode: "markers",
                    name: "Above the scale",
                    showlegend: false,
                    x: xPlot.filter(
                      (_, k) => caps[i].totals[k] > (caps[i].cap ?? 0),
                    ),
                    y: x
                      .filter((_, k) => caps[i].totals[k] > (caps[i].cap ?? 0))
                      .map(() => caps[i].cap),
                    customdata: caps[i].totals.filter(
                      (t) => t > (caps[i].cap ?? 0),
                    ),
                    yaxis: i === 0 ? "y" : `y${i + 1}`,
                    cliponaxis: false,
                    marker: { symbol: "triangle-up", size: 7, color: c.ink },
                    hovertemplate:
                      "%{customdata:,.0f}/h in all, above the scale<extra></extra>",
                  },
                ]),
          ])}
          layout={{
            ...baseLayout(c),
            shapes: tiers.shapes,
            annotations: [...tiers.annotations, ...rowNames],
            height: fs.full ? undefined : height,
            margin: { l: n > 1 ? 44 + nameWidth : 48, r: 12, t: 30, b: 28 },
            showlegend: legend,
            hovermode: "x unified",
            xaxis: {
              ...baseLayout(c).xaxis,
              type: "date",
              range: (visible ?? [lo, hi]).map(toPlotly),
              // Dates under the bottom row, not hanging off the top one into the second.
              anchor: n > 1 ? `y${n}` : "y",
              rangeslider: {
                visible: true,
                thickness: n > 1 ? 0.06 : 0.09,
                bgcolor: rgba(c.grid, 0.4),
                bordercolor: c.grid,
              },
              rangeselector: {
                x: 1,
                xanchor: "right",
                y: 1.03,
                yanchor: "bottom",
                bgcolor: rgba(c.grid, 0.6),
                activecolor: c.axis,
                font: { color: c.ink, size: 10 },
                buttons: [
                  { count: 6, label: "6h", step: "hour", stepmode: "backward" },
                  { count: 1, label: "1d", step: "day", stepmode: "backward" },
                  { count: 7, label: "7d", step: "day", stepmode: "backward" },
                  {
                    count: 30,
                    label: "30d",
                    step: "day",
                    stepmode: "backward",
                  },
                  { step: "all", label: "All" },
                ],
              },
              showspikes: true,
              spikemode: "across",
              spikecolor: c.axis,
              spikethickness: 1,
            },
            ...Object.fromEntries(
              rows.map((_, i) => [
                i === 0 ? "yaxis" : `yaxis${i + 1}`,
                {
                  ...baseLayout(c).yaxis,
                  domain: domain(i),
                  nticks: n > 1 ? 3 : undefined,
                  autorange: false,
                  range: caps[i].range,
                  title:
                    n > 1
                      ? undefined
                      : { text: "per hour", font: { size: 10, color: c.axis } },
                },
              ]),
            ),
          }}
          // Plotly's own legend toggling stays off (return false): a click is the same switch
          // as the kind table's Show box, or the outcome chip.
          onLegendClick={(e: {
            curveNumber: number
            data: { legendgroup?: string }[]
          }) => {
            const id = e.data[e.curveNumber].legendgroup
            // Updaters: Plotly may hold on to an older handler.
            if (legendDim === "kind" && id)
              onHiddenKinds((h) => toggleIn(h, id as Kind))
            if (legendDim === "outcome" && id)
              setHidden((h) =>
                // The last outcome shown stays shown, as with the chips.
                !h.has(id as Outcome) && h.size === OUTCOMES.length - 1
                  ? h
                  : toggleIn(h, id as Outcome),
              )
            return false
          }}
          // A double click shows only that entry, or everything again if it was alone.
          onLegendDoubleClick={(e: {
            curveNumber: number
            data: { legendgroup?: string }[]
          }) => {
            const id = e.data[e.curveNumber].legendgroup
            const isolate =
              <T extends string>(all: T[]) =>
              (h: Set<T>) => {
                const alone =
                  all.every((g) => g === id || h.has(g)) && !h.has(id as T)
                return new Set(alone ? [] : all.filter((g) => g !== id))
              }
            if (legendDim === "kind")
              onHiddenKinds(isolate(KINDS.map((k) => k.id)))
            if (legendDim === "outcome")
              setHidden(isolate(OUTCOMES.map((o) => o.id)))
            return false
          }}
          onRelayout={(e: Record<string, unknown>) => {
            const r =
              (e["xaxis.range"] as (string | number)[] | undefined) ??
              (e["xaxis.range[0]"] !== undefined
                ? [e["xaxis.range[0]"], e["xaxis.range[1]"]]
                : undefined)
            if (r)
              setVisible([
                fromPlotly(r[0] as string),
                fromPlotly(r[1] as string),
              ])
            else if (e["xaxis.autorange"]) setVisible(null)
          }}
        />
      )}
    </div>
  )
}
