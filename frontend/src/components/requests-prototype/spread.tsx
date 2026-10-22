// PROTOTYPE (request-stats): the time filter's spread, when the Requests were made, drawn
// in its popover with the shared zoom bar and drag-to-select histogram. History and Logs bin on the server;
// here the hours are already in the browser, so they are binned here. Never merge.

import { Maximize2, Minimize2 } from "lucide-react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import type { LogSpreadResponse } from "@/client"
import { ZoomControls } from "@/components/AnalysisWindowControl"
import { BarHistogram } from "@/components/filter-tree/BarHistogram"
import { dateText } from "@/components/Spread"
import { spreadZoom, useZoomState } from "@/components/SpreadZoom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TgButton } from "@/components/ui/tg-button"
import { floorToMinute, serverNow } from "@/lib/analysis-window"
import {
  resolveTimeBound,
  type TimeBound,
  timeBoundSummary,
} from "@/lib/time-bound/bound"
import {
  applyFilter,
  type Fact,
  type Filter,
  fmt,
  HOURLY_DAYS,
  REQUEST_DAYS,
} from "./data"

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * Requests per bar across every loaded day, under every page filter but the time
 * bound itself, so it shows what lies around the range chosen. Each hour's Requests
 * sit at the start of their hour.
 */
function requestSpread(
  hourFacts: Fact[],
  dayFacts: Fact[],
  filter: Filter,
  days: string[],
  range: [number, number] | null,
): LogSpreadResponse {
  const whole = { ...filter, from: days[0], to: days[days.length - 1] }
  // Hours where the hourly tier still has them, whole days before that.
  const hourlyFrom = days[Math.max(0, days.length - HOURLY_DAYS)]
  const all = [
    ...applyFilter(hourFacts, whole),
    ...applyFilter(dayFacts, whole).filter((x) => x.day < hourlyFrom),
  ]
  const points = all.map((x) => ({
    at: Date.parse(`${x.day}T00:00:00Z`) + (x.hour ?? 0) * HOUR_MS,
    n: x.requests,
  }))
  if (!points.length)
    return { total: 0, min: null, max: null, median: null, bins: [] }
  points.sort((a, b) => a.at - b.at)
  const min = points[0].at
  const max = points[points.length - 1].at + HOUR_MS
  const total = points.reduce((s, p) => s + p.n, 0)
  // The instant half the Requests were made before.
  let seen = 0
  const median = points.find((p) => (seen += p.n) >= total / 2)?.at ?? min
  // One bar per UTC day, or per hour once under two days show, so a picked bar is
  // exactly the days or hours the page counts rather than 32 bars across them.
  const [a, b] = range ?? [min, max]
  const width = b - a >= 2 * DAY_MS ? DAY_MS : HOUR_MS
  const lo = Math.floor(a / width) * width
  const hi = Math.ceil(b / width) * width
  const bins = Array.from(
    { length: Math.max(1, (hi - lo) / width) },
    (_, i) => ({ lo: lo + i * width, hi: lo + (i + 1) * width, count: 0 }),
  )
  for (const p of points) {
    if (p.at < lo || p.at >= hi) continue
    bins[Math.floor((p.at - lo) / width)].count += p.n
  }
  for (const b of bins) b.count = Math.round(b.count)
  return { total: Math.round(total), min, max, median, bins }
}

export function RequestedSpread({
  hourFacts,
  dayFacts,
  filter,
  days,
  bound,
  onPick,
}: {
  hourFacts: Fact[]
  dayFacts: Fact[]
  filter: Filter
  days: string[]
  bound: TimeBound
  onPick: (bound: TimeBound) => void
}) {
  // One zoom for both views, so full screen opens where the popover was and comes back there.
  const zoom = useZoomState()
  const [full, setFull] = useState(false)
  const spread = requestSpread(hourFacts, dayFacts, filter, days, zoom.range)
  if (!spread.bins.length || spread.min === null || spread.max === null)
    return <p className="text-[11px] text-app-ink/50">No Requests to spread.</p>
  const view = {
    spread: { ...spread, min: spread.min, max: spread.max },
    zoom,
    bound,
    onPick,
  }
  return (
    <>
      <SpreadView {...view} onFullScreen={() => setFull(true)} />
      {/* A Dialog is a layer above the popover, so picking in it does not close the popover. */}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent
          className="req-proto flex h-[92vh] w-[96vw] max-w-none flex-col sm:max-w-none"
          showCloseButton={false}
        >
          <DialogHeader className="flex-row items-center gap-3">
            <DialogTitle className="text-sm">
              When the Requests were made
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {timeBoundSummary(bound, floorToMinute(serverNow()))}. Drag across
              the bars to pick a range, scroll to move along it.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <SpreadView {...view} tall onFullScreen={() => setFull(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The spread itself: the zoom row with its full-screen switch, the bars, the scrollbar. */
function SpreadView({
  spread,
  zoom,
  bound,
  onPick,
  tall = false,
  onFullScreen,
}: {
  spread: LogSpreadResponse & { min: number; max: number }
  zoom: ReturnType<typeof useZoomState>
  bound: TimeBound
  onPick: (bound: TimeBound) => void
  /** Full screen: the bars fill the height they are given. */
  tall?: boolean
  onFullScreen: () => void
}) {
  const pan = usePan(zoom, spread.min, spread.max)
  const { bins } = spread
  const { start, end } = resolveTimeBound(bound, floorToMinute(serverNow()))
  const [from, to] = zoom.range ?? [spread.min, spread.max]
  const write = (ms: number) => dateText(ms, to - from)
  // The shared SpreadZoomBar's row, with one more button beside its two.
  const z = spreadZoom(
    {
      lo: spread.min,
      hi: spread.max,
      log: false,
      median: spread.median ?? spread.min,
      bound:
        start === undefined && end === undefined
          ? null
          : { min: start, max: end },
    },
    zoom,
  )
  const FullIcon = tall ? Minimize2 : Maximize2
  return (
    <div className={tall ? "flex h-full flex-col gap-2" : "space-y-1"}>
      <div className="flex items-center gap-1.5">
        <span className="flex-1" />
        <ZoomControls
          onIn={z.zoomIn}
          onOut={z.zoomOut}
          inDisabled={!z.canIn}
          outDisabled={!z.canOut}
        />
        <TgButton
          size="sm"
          variant="secondary"
          aria-label={
            tall ? "Leave the spread's full screen" : "Spread full screen"
          }
          title={tall ? "Leave full screen" : "Watch the spread full screen"}
          onClick={onFullScreen}
        >
          <FullIcon size={13} />
        </TgButton>
      </div>
      {/* The Channels tab's histogram, so a drag across the bars picks a run of days (or hours). */}
      <div
        className={`relative ${tall ? "min-h-0 flex-1 [&_[role=presentation]]:h-[calc(92vh-9rem)]" : ""}`}
        ref={pan.wheelRef}
      >
        <TierEdges lo={bins[0].lo} hi={bins[bins.length - 1].hi} tall={tall} />
        <BarHistogram
          testId="requests-spread"
          bins={bins.map((b) => b.count)}
          solid={(i) =>
            (start === undefined || bins[i].hi > start) &&
            (end === undefined || bins[i].lo < end) &&
            (start !== undefined || end !== undefined)
          }
          onSelect={(run) => {
            const a = bins[Math.min(run.from, run.to)]
            const b = bins[Math.max(run.from, run.to)]
            onPick({ mode: "fixed", start: a.lo, end: b.hi })
          }}
          caption={(bar) => [
            write(from),
            bar !== null
              ? `${fmt(bins[bar].count)} Requests, ${write(bins[bar].lo)}–${write(bins[bar].hi)}`
              : `median ${write(spread.median ?? from)} · drag to pick`,
            write(to),
          ]}
        />
      </div>
      {pan.thumb && (
        <div
          className="relative h-1.5 rounded-full bg-app-ink/10"
          title="Scroll over the bars, or drag this, to move along the whole spread"
        >
          <div
            role="scrollbar"
            aria-orientation="horizontal"
            aria-label="The part of the spread shown"
            aria-valuenow={Math.round(pan.thumb.left)}
            aria-controls="requests-spread"
            tabIndex={0}
            onPointerDown={pan.startDrag}
            onKeyDown={(e) => {
              const step =
                e.key === "ArrowLeft"
                  ? -0.25
                  : e.key === "ArrowRight"
                    ? 0.25
                    : 0
              if (!step || !zoom.range) return
              e.preventDefault()
              // Or the prototype's variant switcher takes the same arrow too.
              e.stopPropagation()
              pan.shift(step * (zoom.range[1] - zoom.range[0]))
            }}
            className="absolute inset-y-0 cursor-grab touch-none rounded-full bg-app-ink/40 hover:bg-app-ink/60 active:cursor-grabbing"
            style={{ left: `${pan.thumb.left}%`, width: `${pan.thumb.width}%` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Moving a zoomed spread along the whole one: the wheel or a trackpad swipe over the bars,
 * or a drag of the bar under them. Nothing to move while the whole spread shows.
 */
function usePan(
  zoom: ReturnType<typeof useZoomState>,
  min: number | null,
  max: number | null,
) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const range = zoom.range
  const zoomed =
    range !== null &&
    min !== null &&
    max !== null &&
    (range[0] > min || range[1] < max)
  const shift = (by: number) => {
    if (!range || min === null || max === null) return
    const span = range[1] - range[0]
    const a = Math.min(Math.max(range[0] + by, min), max - span)
    zoom.setRange([a, a + span])
  }
  const shiftRef = useRef(shift)
  shiftRef.current = shift
  useEffect(() => {
    const el = wheelRef.current
    if (!el || !zoomed || !range) return
    // Not passive: a scroll that moves the spread must not also scroll the popover.
    const onWheel = (e: WheelEvent) => {
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!delta) return
      e.preventDefault()
      shiftRef.current((delta / el.clientWidth) * (range[1] - range[0]))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomed, range])
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!range || min === null || max === null) return
    const track = e.currentTarget.parentElement as HTMLElement
    const x0 = e.clientX
    const a0 = range[0]
    const span = range[1] - range[0]
    const onMove = (m: PointerEvent) => {
      const a = Math.min(
        Math.max(
          a0 + ((m.clientX - x0) / track.clientWidth) * (max - min),
          min,
        ),
        max - span,
      )
      zoom.setRange([a, a + span])
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  const thumb =
    zoomed && range && min !== null && max !== null
      ? {
          left: (100 * (range[0] - min)) / (max - min),
          width: (100 * (range[1] - range[0])) / (max - min),
        }
      : null
  return { wheelRef, startDrag, thumb, shift }
}

/**
 * Where each tier's history ends: before the 7-day line there are no single Requests to
 * open, before the 30-day line no hours. Drawn over the bars, so a drag passes through.
 */
function TierEdges({
  lo,
  hi,
  tall = false,
}: {
  lo: number
  hi: number
  tall?: boolean
}) {
  const now = Date.now()
  const edges = [
    {
      at: now - REQUEST_DAYS * DAY_MS,
      label: `${REQUEST_DAYS}d · each Request`,
    },
    { at: now - HOURLY_DAYS * DAY_MS, label: `${HOURLY_DAYS}d · hourly` },
  ].filter((e) => e.at > lo && e.at < hi)
  return (
    <>
      {edges.map((e) => (
        <div
          key={e.label}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-fuchsia-400/70"
          style={{
            left: `${(100 * (e.at - lo)) / (hi - lo)}%`,
            height: tall ? "calc(92vh - 9rem)" : "4rem",
          }}
        >
          <span className="absolute -top-3.5 left-0.5 whitespace-nowrap text-[9px] text-fuchsia-300">
            {e.label}
          </span>
        </div>
      ))}
    </>
  )
}
