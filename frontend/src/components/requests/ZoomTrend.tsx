/**
 * The Requests tab's zoomable trend (RQS-07), in Plotly. `RequestsView`
 * loads this module lazily, so Plotly downloads only when the trend draws.
 * The buckets follow the zoom (`lib/requests/zoom`); Plotly brings the zoom,
 * pan, range slider and range buttons.
 */
import { Maximize2, Minimize2 } from "lucide-react"
import Plotly from "plotly.js-dist-min"
import { useEffect, useState } from "react"
import createPlotlyComponentModule from "react-plotly.js/factory"
import type { RequestTrendResponse } from "@/client"
import { MINUTE_MS } from "@/lib/analysis-window"
import type { Outcome } from "@/lib/requests/breakdown"
import {
  bandLabels,
  fromPlotly,
  rebucket,
  storedBuckets,
  tierBands,
  toPlotly,
  trendLine,
} from "@/lib/requests/zoom"
import { DAY_MS } from "@/lib/scope/window"

// The factory is CommonJS; Vite hands it over either bare or as `{ default }`.
const createPlotlyComponent =
  (
    createPlotlyComponentModule as unknown as {
      default?: typeof createPlotlyComponentModule
    }
  ).default ?? createPlotlyComponentModule
const Plot = createPlotlyComponent(Plotly)

/** Plotly styles its own SVG and cannot read CSS variables, so it gets them resolved. */
const COLOR_VARS = {
  line: "--layer-charged",
  ink: "--ink",
  axis: "--viz-axis",
  grid: "--viz-grid",
  surface: "--card-bg",
  band: "--account-4",
}
type Colors = Record<keyof typeof COLOR_VARS, string>

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(
    Object.entries(COLOR_VARS).map(([k, v]) => [
      k,
      style.getPropertyValue(v).trim(),
    ]),
  ) as Colors
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

/**
 * The zoomable trend: Requests per hour over the tab's range, its buckets
 * re-summed as the zoom changes, down to 5 minutes where each Request is
 * kept. "Use the visible range" sets the tab's range to the zoom.
 */
export default function ZoomTrend({
  trend,
  range,
  hiddenKinds,
  hiddenOutcomes,
  onRange,
}: {
  trend: RequestTrendResponse
  /** The tab's range, epoch ms; an open start begins at the first bucket. */
  range: { start: number; end: number }
  hiddenKinds: ReadonlySet<string>
  hiddenOutcomes: ReadonlySet<Outcome>
  /** The visible range was picked, cut out to whole minutes. */
  onRange: (start: number, end: number) => void
}) {
  const c = useColors()
  const [full, setFull] = useFullScreen()
  const stored = storedBuckets(trend.buckets)
  const hi = range.end
  const lo = range.start || (stored[0]?.t ?? hi - DAY_MS)
  // A zoom belongs to the range it was made in; a new range starts unzoomed.
  const [zoom, setZoom] = useState<{ of: string; to: [number, number] }>()
  const visible = zoom?.of === `${lo}-${hi}` ? zoom.to : null
  const [from, to] = visible ?? [lo, hi]
  const { size, points } = rebucket(stored, from, to)
  const line = trendLine(points, size, hiddenKinds, hiddenOutcomes)
  const Icon = full ? Minimize2 : Maximize2
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
      {/* The size on a wrapper: a className on Plot's own div would drop Plotly's. */}
      <div className={full ? "min-h-0 flex-1" : undefined}>
        {c && (
          <Plot
            style={{ width: "100%", height: full ? "100%" : 340 }}
            useResizeHandler
            config={{
              displaylogo: false,
              responsive: true,
              scrollZoom: true,
              modeBarButtonsToRemove: [
                "select2d",
                "lasso2d",
                "autoScale2d",
                "toImage",
              ],
            }}
            data={[
              {
                type: "scatter",
                mode: "lines",
                name: "Requests",
                x: line.x,
                y: line.y,
                text: line.hover,
                fill: "tozeroy",
                fillcolor: c.line,
                line: { shape: line.shape, smoothing: 0.6, width: 0 },
                hovertemplate: "%{text}<br>%{y:,.0f}/h<extra></extra>",
              },
            ]}
            layout={layout(c, tierBands(stored, lo, hi), [from, to], full)}
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

/** The trend's look: the app's ink on a transparent ground, the tiers behind. */
function layout(
  c: Colors,
  bands: ReturnType<typeof tierBands>,
  view: [number, number],
  full: boolean,
): Partial<Plotly.Layout> {
  const tiers = tierShapes(c, bands, view)
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: c.ink, size: 11, family: "inherit" },
    margin: { l: 48, r: 12, t: 30, b: 28 },
    height: full ? undefined : 340,
    showlegend: false,
    hovermode: "x unified",
    hoverlabel: {
      bgcolor: c.surface,
      bordercolor: c.grid,
      font: { color: c.ink, size: 11 },
    },
    shapes: tiers.shapes,
    annotations: tiers.annotations,
    xaxis: {
      type: "date",
      range: [toPlotly(view[0]), toPlotly(view[1])],
      gridcolor: c.grid,
      linecolor: c.grid,
      zeroline: false,
      rangeslider: {
        visible: true,
        thickness: 0.09,
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
    yaxis: {
      gridcolor: c.grid,
      linecolor: c.grid,
      zeroline: false,
      tickformat: "~s",
      rangemode: "tozero",
      title: { text: "per hour", font: { size: 10, color: c.axis } },
    },
  }
}
