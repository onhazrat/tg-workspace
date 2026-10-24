/**
 * The Requested range picker's spread (RQS-09): when Requests were made, over
 * everything kept, drawn in the time bound's popover. The app's bar
 * histogram and zoom controls, with the 7-day and 30-day edges marked; a
 * drag across the bars picks a range, the wheel, the scrollbar or its arrow
 * keys move a zoomed spread, and full screen keeps the zoom.
 */
import { Maximize2, Minimize2 } from "lucide-react"
import type React from "react"
import { useEffect, useRef } from "react"
import type { RequestSpreadResponse } from "@/client"
import { ZoomControls } from "@/components/AnalysisWindowControl"
import { BarHistogram } from "@/components/filter-tree/BarHistogram"
import { dateText } from "@/components/Spread"
import {
  spreadZoom,
  useZoomState,
  type ZoomState,
} from "@/components/SpreadZoom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TgButton } from "@/components/ui/tg-button"
import { useFullScreen } from "@/hooks/useFullScreen"
import { floorToMinute, serverNow } from "@/lib/analysis-window"
import { fmt } from "@/lib/requests/breakdown"
import {
  panned,
  requestedSpread,
  type RequestedSpread as Shown,
  tierEdges,
} from "@/lib/requests/spread"
import {
  resolveTimeBound,
  type TimeBound,
  timeBoundSummary,
} from "@/lib/time-bound/bound"

type View = {
  spread: Shown
  zoom: ZoomState
  bound: TimeBound
  onPick: (bound: TimeBound) => void
  edges: { at: number; label: string }[]
  /** The server's minute, which a Live bound is resolved against. */
  now: number
}

export function RequestedSpread({
  spread,
  bound,
  onPick,
  now = floorToMinute(serverNow()),
}: {
  spread?: RequestSpreadResponse
  bound: TimeBound
  onPick: (bound: TimeBound) => void
  /** The server's minute: where the tier edges are measured from. */
  now?: number
}) {
  // One zoom for both views, so full screen opens where the popover was.
  const zoom = useZoomState()
  const [full, setFull] = useFullScreen()
  if (!spread)
    return <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
  const shown = requestedSpread(spread.buckets, zoom.range)
  if (!shown)
    return <p className="text-[11px] text-app-ink/50">No Requests to spread.</p>
  const { lo } = shown.bins[0]
  const hi = shown.bins[shown.bins.length - 1].hi
  const view: View = {
    spread: shown,
    zoom,
    bound,
    onPick,
    now,
    edges: tierEdges(now, spread.recordDays, spread.hourlyDays, lo, hi),
  }
  return (
    <>
      <SpreadView {...view} onFullScreen={() => setFull(true)} />
      {/* A layer above the popover, so picking in it keeps the popover open. */}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent
          className="flex h-[92vh] w-[96vw] max-w-none flex-col sm:max-w-none"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="text-sm">
              When the Requests were made
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {timeBoundSummary(bound, now)}. Drag across the bars to pick a
              range, scroll to move along it.
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

/** The zoom row with its full-screen switch, the bars, the scrollbar. */
function SpreadView({
  tall = false,
  onFullScreen,
  ...view
}: View & { tall?: boolean; onFullScreen: () => void }) {
  const { spread, zoom } = view
  const pan = usePan(zoom, spread.min, spread.max)
  return (
    <div className={tall ? "flex h-full flex-col gap-2" : "space-y-1"}>
      <ZoomRow {...view} tall={tall} onFullScreen={onFullScreen} />
      <div
        ref={pan.wheelRef}
        className={`relative ${tall ? "min-h-0 flex-1 [&_[role=presentation]]:h-[calc(92vh-9rem)]" : ""}`}
      >
        <TierEdges {...view} tall={tall} />
        <Bars {...view} />
      </div>
      {pan.thumb && <Scrollbar thumb={pan.thumb} pan={pan} zoom={zoom} />}
    </div>
  )
}

function ZoomRow({
  spread,
  zoom,
  bound,
  now,
  tall,
  onFullScreen,
}: View & { tall: boolean; onFullScreen: () => void }) {
  const { start, end } = resolveTimeBound(bound, now)
  const z = spreadZoom(
    {
      lo: spread.min,
      hi: spread.max,
      log: false,
      median: spread.median,
      bound:
        start === undefined && end === undefined
          ? null
          : { min: start, max: end },
    },
    zoom,
  )
  const Icon = tall ? Minimize2 : Maximize2
  return (
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
        <Icon size={13} />
      </TgButton>
    </div>
  )
}

/** The app's histogram: a drag across the bars picks a run of days or hours. */
function Bars({ spread, zoom, bound, onPick, now }: View) {
  const { bins } = spread
  const { start, end } = resolveTimeBound(bound, now)
  const [from, to] = zoom.range ?? [spread.min, spread.max]
  const write = (ms: number) => dateText(ms, to - from)
  return (
    <BarHistogram
      testId="requests-spread"
      bins={bins.map((b) => b.count)}
      solid={(i) =>
        (start !== undefined || end !== undefined) &&
        (start === undefined || bins[i].hi > start) &&
        (end === undefined || bins[i].lo < end)
      }
      onSelect={(run) =>
        onPick({
          mode: "fixed",
          start: bins[Math.min(run.from, run.to)].lo,
          end: bins[Math.max(run.from, run.to)].hi,
        })
      }
      caption={(bar) => [
        write(from),
        bar === null
          ? `median ${write(spread.median)} · drag to pick`
          : `${fmt(bins[bar].count)} Requests, ${write(bins[bar].lo)}–${write(bins[bar].hi)}`,
        write(to),
      ]}
    />
  )
}

/**
 * Where each tier's history ends: before the 7-day line no single Requests
 * are kept, before the 30-day line no hours. Over the bars, so a drag passes
 * through.
 */
function TierEdges({ spread, edges, tall }: View & { tall: boolean }) {
  const { lo } = spread.bins[0]
  const hi = spread.bins[spread.bins.length - 1].hi
  return edges.map((e) => (
    <div
      key={e.label}
      aria-hidden
      data-testid="requests-spread-edge"
      className="pointer-events-none absolute z-10 border-l border-dashed border-fuchsia-500/70"
      style={{
        left: `${(100 * (e.at - lo)) / (hi - lo)}%`,
        height: tall ? "calc(92vh - 9rem)" : "4rem",
      }}
    >
      <span className="absolute -top-3.5 left-0.5 whitespace-nowrap text-[9px] text-fuchsia-600 dark:text-fuchsia-300">
        {e.label}
      </span>
    </div>
  ))
}

type Pan = ReturnType<typeof usePan>

function Scrollbar({
  thumb,
  pan,
  zoom,
}: {
  thumb: NonNullable<Pan["thumb"]>
  pan: Pan
  zoom: ZoomState
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    // A quarter of what is shown, per arrow key.
    const step = { ArrowLeft: -0.25, ArrowRight: 0.25 }[e.key]
    if (!step || !zoom.range) return
    e.preventDefault()
    // Or a keyboard shortcut outside the popover takes the same arrow.
    e.stopPropagation()
    pan.shift(step * (zoom.range[1] - zoom.range[0]))
  }
  return (
    <div
      className="relative h-1.5 rounded-full bg-app-ink/10"
      title="Scroll over the bars, or drag this, to move along the whole spread"
    >
      <div
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label="The part of the spread shown"
        aria-controls="requests-spread"
        aria-valuenow={Math.round(thumb.left)}
        tabIndex={0}
        onPointerDown={pan.startDrag}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 cursor-grab touch-none rounded-full bg-app-ink/40 hover:bg-app-ink/60 active:cursor-grabbing"
        style={{ left: `${thumb.left}%`, width: `${thumb.width}%` }}
      />
    </div>
  )
}

/**
 * Moving a zoomed spread along the whole one: the wheel or a trackpad swipe
 * over the bars, or a drag of the bar under them. Nothing to move while the
 * whole spread shows.
 */
function usePan(zoom: ZoomState, min: number, max: number) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const range = zoom.range
  const shift = (by: number) => {
    if (range) zoom.setRange(panned(range, by, min, max))
  }
  const shiftRef = useRef(shift)
  shiftRef.current = shift
  const span = range ? range[1] - range[0] : 0
  useEffect(() => {
    const el = wheelRef.current
    if (!el || !span) return
    // Not passive: a scroll that moves the spread must not scroll the popover.
    const onWheel = (e: WheelEvent) => {
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!delta) return
      e.preventDefault()
      shiftRef.current((delta / el.clientWidth) * span)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [span])
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!range) return
    const track = e.currentTarget.parentElement as HTMLElement
    const [x0, start] = [e.clientX, range]
    const onMove = (m: PointerEvent) =>
      zoom.setRange(
        panned(
          start,
          ((m.clientX - x0) / track.clientWidth) * (max - min),
          min,
          max,
        ),
      )
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  const thumb = range && {
    left: (100 * (range[0] - min)) / (max - min),
    width: (100 * (range[1] - range[0])) / (max - min),
  }
  return { wheelRef, startDrag, thumb, shift }
}
