/**
 * The Requests tab's zoomable trend (RQS-07, RQS-08), in Plotly.
 * `RequestsView` loads this module lazily, so Plotly downloads only when the
 * trend draws. The buckets follow the zoom, and the rows, shades and scale
 * follow the switches (`lib/requests/zoom`); Plotly brings the zoom, pan,
 * range slider and range buttons.
 */
import { Maximize2, Minimize2 } from "lucide-react"
import Plotly from "plotly.js-dist-min"
import { useEffect, useRef, useState } from "react"
import createPlotlyComponentModule from "react-plotly.js/factory"
import type { RequestTrendResponse } from "@/client"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import { MINUTE_MS } from "@/lib/analysis-window"
import { KINDS, OUTCOMES, type Outcome } from "@/lib/requests/breakdown"
import {
  bandLabels,
  DOUBLE_CLICK_MS,
  fromPlotly,
  type Hidden,
  legendClick,
  legendDoubleClick,
  type Part,
  rebucket,
  type Split,
  type Splits,
  shadeOf,
  storedBuckets,
  tierBands,
  toPlotly,
  trendChart,
} from "@/lib/requests/zoom"
import { DAY_MS } from "@/lib/scope/window"
import { OutcomeChips } from "./parts"

// The factory is CommonJS; Vite hands it over either bare or as `{ default }`.
const createPlotlyComponent =
  (
    createPlotlyComponentModule as unknown as {
      default?: typeof createPlotlyComponentModule
    }
  ).default ?? createPlotlyComponentModule
const Plot = createPlotlyComponent(Plotly)

/** Plotly styles its own SVG and cannot read CSS variables, so it gets them resolved. */
const COLOR_VARS: Record<string, string> = {
  line: "--layer-charged",
  ink: "--ink",
  axis: "--viz-axis",
  grid: "--viz-grid",
  surface: "--card-bg",
  band: "--account-4",
  ...Object.fromEntries(KINDS.map((k) => [k.id, `--kind-${k.id}`])),
  ...Object.fromEntries(OUTCOMES.map((o) => [o.id, `--outcome-${o.id}`])),
}
type Colors = Record<string, string>

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(
    Object.entries(COLOR_VARS).map(([k, v]) => [
      k,
      style.getPropertyValue(v).trim(),
    ]),
  )
}

/** The theme's colours, read again when the theme's class on `<html>` changes. */
function useColors() {
  const [colors, setColors] = useState<Colors | null>(null)
  useEffect(() => {
    setColors(readColors())
    const watch = new MutationObserver(() => setColors(readColors()))
    watch.observe(document.documentElement, { attributeFilter: ["class"] })
    return () => watch.disconnect()
  }, [])
  return colors
}

/**
 * Full screen without a remount: the same frame goes fixed over the page, so
 * Plotly's zoom carries over. Escape leaves it, before the keyboard mode sees it.
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
  return [full, setFull] as const
}

/**
 * A legend click waits out the double-click delay, as Plotly's own legend
 * does, and a double click drops it: a click that hid a kind would redraw the
 * legend, and the redraw makes Plotly read the second click as a new one.
 */
function useLegendClicks(
  onHidden: (update: (h: Hidden) => Partial<Hidden>) => void,
) {
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(pending.current), [])
  return (update: (h: Hidden) => Partial<Hidden>, double: boolean) => {
    clearTimeout(pending.current)
    if (double) onHidden(update)
    else pending.current = setTimeout(() => onHidden(update), DOUBLE_CLICK_MS)
  }
}

const smallButton =
  "rounded border border-app-ink/20 px-1.5 py-0.5 hover:bg-app-ink/10"
const RANGE_BUTTONS = [
  { count: 6, label: "6h", step: "hour", stepmode: "backward" },
  { count: 1, label: "1d", step: "day", stepmode: "backward" },
  { count: 7, label: "7d", step: "day", stepmode: "backward" },
  { count: 30, label: "30d", step: "day", stepmode: "backward" },
  { step: "all", label: "All" },
] as const

/** The tiers as bands behind the trend, each named at its top when wide in the view. */
function tierShapes(
  c: Colors,
  bands: ReturnType<typeof tierBands>,
  [from, to]: [number, number],
) {
  const look: Record<string, { fill: string; opacity: number }> = {
    "daily totals": { fill: "rgba(0,0,0,0)", opacity: 1 },
    "hourly totals": { fill: c.grid, opacity: 0.35 },
    "each Request": { fill: c.band, opacity: 0.16 },
  }
  return {
    shapes: bands.map((b) => ({
      type: "rect" as const,
      xref: "x" as const,
      yref: "paper" as const,
      x0: toPlotly(b.x0),
      x1: toPlotly(b.x1),
      y0: 0,
      y1: 1,
      fillcolor: look[b.label].fill,
      opacity: look[b.label].opacity,
      line: { width: 0 },
      layer: "below" as const,
    })),
    annotations: bandLabels(bands, from, to).map((b) => ({
      xref: "x" as const,
      yref: "paper" as const,
      x: toPlotly(b.x),
      y: 1,
      xanchor: "left" as const,
      yanchor: "top" as const,
      text: b.text,
      showarrow: false,
      font: { size: 9, color: c.axis },
    })),
  }
}

/** The zoom's range out of a Plotly relayout event: a pair, null for all, or nothing. */
export function relayoutRange(
  e: Record<string, unknown>,
): [number, number] | null | undefined {
  const r =
    (e["xaxis.range"] as (string | number)[] | undefined) ??
    (e["xaxis.range[0]"] === undefined
      ? undefined
      : [e["xaxis.range[0]"] as string, e["xaxis.range[1]"] as string])
  if (r) return [fromPlotly(r[0]), fromPlotly(r[1])]
  return e["xaxis.autorange"] ? null : undefined
}

/** One dimension's switches: told apart or not, then stacked or a row each. */
function SplitSwitch({
  dim,
  split,
  onSplit,
}: {
  dim: keyof Splits
  split: Split
  onSplit: (split: Split) => void
}) {
  const on = split !== "off"
  return (
    <span className="flex items-center gap-1">
      <BarToggle
        on={on}
        label={`Separate by ${dim}`}
        title={on ? `Merge the ${dim}s into one` : `Tell the ${dim}s apart`}
        testId={`requests-split-${dim}`}
        onClick={() => onSplit(on ? "off" : "stacked")}
      />
      <TgInlineChoice<Split>
        aria-label={`${dim}s stacked or separate`}
        options={[
          { value: "stacked", label: "Stacked", disabled: !on },
          { value: "separate", label: "Separate", disabled: !on },
        ]}
        value={split}
        onChange={onSplit}
      />
    </span>
  )
}

type Chart = ReturnType<typeof trendChart>

/** A series' fill: a kind's colour, shaded by outcome when both are told apart. */
function fillOf(c: Colors, { kind, outcome }: Part) {
  const hue = kind && c[KINDS.some((k) => k.id === kind) ? kind : "other"]
  if (hue && outcome) return shadeOf(hue, c.surface, outcome)
  return hue || (outcome ? c[outcome] : c.line)
}

const axisOf = (i: number) => (i === 0 ? "y" : `y${i + 1}`)

/**
 * Each row's series stacked in its own area, on its own y axis. Fills only,
 * with a hairline in the surface colour between shaded layers: a line in the
 * series' colour would draw the top one over the rest. A row whose scale is
 * capped gets a notch on each bucket above it, with the real rate on hover.
 */
function traces(chart: Chart, c: Colors): Partial<Plotly.ScatterData>[] {
  const listed = new Set<string>()
  return chart.rows.flatMap((row, i) => {
    const series = row.series.map((s, j): Partial<Plotly.ScatterData> => {
      const first = !!s.group && !listed.has(s.group)
      if (s.group) listed.add(s.group)
      return {
        type: "scatter",
        mode: "lines",
        name: s.name,
        legendgroup: s.group,
        showlegend: first,
        visible: s.off ? "legendonly" : true,
        x: chart.x,
        y: s.y,
        text: chart.hover,
        yaxis: axisOf(i),
        stackgroup: `row${i}`,
        fillcolor: fillOf(c, s.part),
        line: {
          shape: chart.shape,
          smoothing: 0.6,
          width: s.part.kind && s.part.outcome ? 0.75 : 0,
          color: c.surface,
        },
        // The bucket's span, grain and count once, on the first series.
        hovertemplate: `${i + j === 0 ? "%{text}<br>" : ""}%{y:,.0f}/h<extra>${s.name}</extra>`,
      }
    })
    if (row.cap === null) return series
    const notches: Partial<Plotly.ScatterData> = {
      type: "scatter",
      mode: "markers",
      name: "Above the scale",
      showlegend: false,
      x: row.notches.map((n) => n.x),
      y: row.notches.map(() => row.cap as number),
      customdata: row.notches.map((n) => n.total),
      yaxis: axisOf(i),
      cliponaxis: false,
      marker: { symbol: "triangle-up", size: 7, color: c.ink },
      hovertemplate:
        "%{customdata:,.0f}/h in all, above the scale<extra></extra>",
    }
    return [...series, notches]
  })
}

/** The figure's height: in the layout too, as Plotly measures its box only on a window resize. */
const heightOf = (rows: number) =>
  rows === 1 ? 340 : (rows > 6 ? 70 : 110) * rows + 130

/** Row `i` of `n`, top down, as a share of the plot's height. */
function domainOf(i: number, n: number): [number, number] {
  const gap = n > 6 ? 0.012 : 0.025
  const height = (1 - gap * (n - 1)) / n
  const top = 1 - i * (height + gap)
  return [Math.max(0, top - height), top]
}

/**
 * A y axis per row, each on its own scale, and the rows' names level beside
 * them: a rotated axis title runs into its neighbours on thin rows.
 */
function rowAxes(chart: Chart, c: Colors) {
  const n = chart.rows.length
  const axis = { gridcolor: c.grid, linecolor: c.grid, zeroline: false }
  const axes = chart.rows.map((row, i) => [
    i === 0 ? "yaxis" : `yaxis${i + 1}`,
    {
      ...axis,
      tickformat: "~s",
      domain: n > 1 ? domainOf(i, n) : [0, 1],
      nticks: n > 1 ? 3 : undefined,
      autorange: false,
      range: row.range,
      title:
        n > 1
          ? undefined
          : { text: "per hour", font: { size: 10, color: c.axis } },
    },
  ])
  const names = (n > 1 ? chart.rows : []).map((row, i) => ({
    xref: "paper" as const,
    yref: "paper" as const,
    x: 0,
    y: domainOf(i, n).reduce((a, b) => a + b) / 2,
    xanchor: "right" as const,
    xshift: -34,
    text: row.name,
    showarrow: false,
    font: { size: 10, color: c.axis },
  }))
  const nameWidth = Math.max(0, ...names.map((a) => a.text.length)) * 6
  return { axes: Object.fromEntries(axes), names, nameWidth }
}

/**
 * The zoomable trend: Requests per hour over the tab's range, its buckets
 * re-summed as the zoom changes, down to 5 minutes where each Request is
 * kept. The switches split it by kind and outcome; the legend is the kind
 * table's Show boxes, or the outcome chips. "Use the visible range" sets the
 * tab's range to the zoom.
 */
export default function ZoomTrend({
  trend,
  range,
  hiddenKinds,
  hiddenOutcomes,
  onHidden,
  onRange,
}: {
  trend: RequestTrendResponse
  /** The tab's range, epoch ms; an open start begins at the first bucket. */
  range: { start: number; end: number }
  hiddenKinds: ReadonlySet<string>
  hiddenOutcomes: ReadonlySet<Outcome>
  /** The legend or a chip hid or showed kinds or outcomes, as an update of the tab's. */
  onHidden: (update: (h: Hidden) => Partial<Hidden>) => void
  /** The visible range was picked, cut out to whole minutes. */
  onRange: (start: number, end: number) => void
}) {
  const c = useColors()
  const [full, setFull] = useFullScreen()
  const [splits, setSplits] = useState<Splits>({
    kind: "stacked",
    outcome: "stacked",
  })
  const stored = storedBuckets(trend.buckets)
  const hi = range.end
  const lo = range.start || (stored[0]?.t ?? hi - DAY_MS)
  // A zoom belongs to the range it was made in; a new range starts unzoomed.
  const [zoom, setZoom] = useState<{ of: string; to: [number, number] }>()
  const visible = zoom?.of === `${lo}-${hi}` ? zoom.to : null
  const view: [number, number] = visible ?? [lo, hi]
  const { size, points } = rebucket(stored, ...view)
  const chart = trendChart(
    points,
    size,
    view,
    splits,
    hiddenKinds,
    hiddenOutcomes,
  )
  const height = heightOf(Math.max(1, chart.rows.length))
  const legendClicks = useLegendClicks(onHidden)
  const Icon = full ? Minimize2 : Maximize2
  // Plotly's own legend toggling stays off (return false): a click is the tab's switch.
  const onLegend =
    (double: boolean) =>
    (e: { curveNumber: number; data: { legendgroup?: string }[] }) => {
      const id = e.data[e.curveNumber]?.legendgroup
      if (chart.legend && id)
        legendClicks(
          double
            ? legendDoubleClick(chart.legend, id, chart.kinds)
            : legendClick(chart.legend, id),
          double,
        )
      return false
    }
  return (
    <section
      data-testid="requests-zoom-trend"
      className={
        full
          ? "fixed inset-3 z-[100000] flex flex-col gap-1.5 rounded-md border border-app-ink/20 bg-app-card p-3 shadow-2xl"
          : "space-y-1.5 rounded-md border border-app-ink/10 bg-app-card p-2"
      }
    >
      <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-app-ink/60">
        <span>
          Requests per hour. Buckets narrow as you zoom in, down to 5 minutes
          for the last week; hover gives each bucket's exact count. Drag or
          scroll to zoom, the slider to pan, double-click to reset.
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {visible && (
            <button
              type="button"
              data-testid="requests-use-visible"
              className={smallButton}
              onClick={() =>
                onRange(
                  Math.floor(visible[0] / MINUTE_MS) * MINUTE_MS,
                  Math.ceil(visible[1] / MINUTE_MS) * MINUTE_MS,
                )
              }
            >
              Use the visible range
            </button>
          )}
          {(["kind", "outcome"] as const).map((dim) => (
            <SplitSwitch
              key={dim}
              dim={dim}
              split={splits[dim]}
              onSplit={(split) => setSplits({ ...splits, [dim]: split })}
            />
          ))}
          <button
            type="button"
            className={smallButton}
            aria-label={
              full ? "Leave the trend's full screen" : "Trend full screen"
            }
            title={
              full ? "Leave full screen (Esc)" : "Watch the trend full screen"
            }
            onClick={() => setFull(!full)}
          >
            <Icon size={12} />
          </button>
        </span>
      </div>
      <div className="px-1" data-testid="requests-trend-chips">
        <OutcomeChips
          hidden={hiddenOutcomes}
          onToggle={(o) => onHidden(legendClick("outcome", o))}
          shades={splits.kind !== "off" && splits.outcome !== "off"}
        />
      </div>
      {/* The size on a wrapper: a className on Plot's own div would drop Plotly's. */}
      <div className={full ? "min-h-0 flex-1" : undefined}>
        {c && (
          <Plot
            style={{ width: "100%", height: full ? "100%" : height }}
            useResizeHandler
            config={{
              displaylogo: false,
              doubleClickDelay: DOUBLE_CLICK_MS,
              responsive: true,
              scrollZoom: true,
              modeBarButtonsToRemove: [
                "select2d",
                "lasso2d",
                "autoScale2d",
                "toImage",
              ],
            }}
            data={traces(chart, c)}
            layout={layout(c, tierBands(stored, lo, hi), view, chart, {
              full,
              height,
            })}
            onLegendClick={onLegend(false)}
            onLegendDoubleClick={onLegend(true)}
            onRelayout={(e) => {
              const r = relayoutRange(e as Record<string, unknown>)
              if (r !== undefined)
                setZoom(r ? { of: `${lo}-${hi}`, to: r } : undefined)
            }}
          />
        )}
      </div>
    </section>
  )
}

/** The trend's look: the app's ink on a transparent ground, the tiers behind, a row per axis. */
function layout(
  c: Colors,
  bands: ReturnType<typeof tierBands>,
  view: [number, number],
  chart: Chart,
  { full, height }: { full: boolean; height: number },
): Partial<Plotly.Layout> {
  const tiers = tierShapes(c, bands, view)
  const rows = rowAxes(chart, c)
  const n = chart.rows.length
  const legend = chart.legend !== null
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: c.ink, size: 11, family: "inherit" },
    margin: {
      l: n > 1 ? 44 + rows.nameWidth : 48,
      r: 12,
      t: legend ? 56 : 30,
      b: 28,
    },
    height: full ? undefined : height,
    showlegend: legend,
    // At the figure's top, above the range buttons.
    legend: {
      orientation: "h",
      x: 0,
      y: 1,
      yref: "container",
      yanchor: "top",
      font: { size: 11 },
    },
    hovermode: "x unified",
    hoverlabel: {
      bgcolor: c.surface,
      bordercolor: c.grid,
      font: { color: c.ink, size: 11 },
    },
    shapes: tiers.shapes,
    annotations: [...tiers.annotations, ...rows.names],
    xaxis: {
      type: "date",
      range: [toPlotly(view[0]), toPlotly(view[1])],
      gridcolor: c.grid,
      linecolor: c.grid,
      zeroline: false,
      // Dates under the bottom row, not hanging off the top one into the second.
      anchor: n > 1 ? (`y${n}` as Plotly.AxisName) : "y",
      rangeslider: {
        visible: true,
        thickness: n > 1 ? 0.06 : 0.09,
        bgcolor: "rgba(0,0,0,0)",
        bordercolor: c.grid,
        borderwidth: 1,
      },
      // Left, clear of Plotly's mode bar on the right.
      rangeselector: {
        x: 0,
        xanchor: "left",
        y: 1.03,
        yanchor: "bottom",
        bgcolor: c.grid,
        activecolor: c.axis,
        font: { color: c.ink, size: 10 },
        buttons: [...RANGE_BUTTONS],
      },
    },
    ...rows.axes,
  }
}
