// PROTOTYPE: one Spread for every bound and the Analysis window (variant 1).
// Never merge. The bars are `BarHistogram`'s (drag a run, a click is a
// one-bar run); around them the Requested spread's kit: zoom, panning by
// wheel, scrollbar and arrow keys, full screen that keeps the zoom.
import { Maximize2, Minimize2 } from "lucide-react"
import type React from "react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { ZoomControls } from "@/components/AnalysisWindowControl"
import { BarHistogram, type Run } from "@/components/filter-tree/BarHistogram"
import { type Range, spreadZoom, type ZoomState } from "@/components/SpreadZoom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TgButton } from "@/components/ui/tg-button"

export type SpreadBar = { lo: number; hi: number; count: number }

/** What a run picked, in the Spread's values. An open end is `undefined`. */
export type Pick = {
  min?: number
  max?: number
  /** The run touched both ends of the whole Spread: everything measured. */
  all: boolean
  run: { from: number; to: number }
}

/** Zoom and panning, from one of two adapters below. */
export type ZoomKit = {
  canIn: boolean
  canOut: boolean
  zoomIn: () => void
  zoomOut: () => void
  /** Move by a fraction of what is shown; absent while nothing can move. */
  pan?: (fraction: number) => void
  /** The scrollbar: where the shown part sits in the whole, in percent. */
  thumb?: { left: number; width: number } | null
  /** Put the shown part's left edge at this fraction of the whole. */
  moveTo?: (left: number) => void
}

/**
 * Zoom adapter one: a range inside the whole Spread, which a scrollbar moves
 * between known ends. `debounce` waits that long after the last wheel tick
 * before asking a server-drawn Spread again; the thumb moves at once.
 */
export function useRangeZoomKit(
  zoom: ZoomState,
  spreading: {
    lo: number
    hi: number
    log: boolean
    median: number
    bound: { min?: number; max?: number; none?: boolean } | null
  },
  debounce = 0,
): ZoomKit {
  const [pending, setPending] = useState<Range | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const z = spreadZoom(spreading, zoom)
  const { lo, hi, log } = spreading
  const [f, inv] =
    log && lo >= 0
      ? [Math.log1p, Math.expm1]
      : [(x: number) => x, (x: number) => x]
  const range = pending ?? zoom.range
  const commit = (next: Range) => {
    if (!debounce) return zoom.setRange(next)
    setPending(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      zoom.setRange(next)
      setPending(null)
    }, debounce)
  }
  const place = (a: number) => {
    if (!range) return
    const [A, B] = [f(lo), f(hi)]
    const w = f(range[1]) - f(range[0])
    const start = Math.min(Math.max(a, A), B - w)
    commit([inv(start), inv(start + w)])
  }
  const whole = f(hi) - f(lo)
  return {
    ...z,
    pan: range
      ? (fraction) =>
          place(f(range[0]) + fraction * (f(range[1]) - f(range[0])))
      : undefined,
    thumb:
      range && whole > 0
        ? {
            left: (100 * (f(range[0]) - f(lo))) / whole,
            width: (100 * (f(range[1]) - f(range[0]))) / whole,
          }
        : null,
    moveTo: (left) => place(f(lo) + left * whole),
  }
}

/** Two significant figures, so a picked edge reads 1,200 and not 1,187.43. */
export const nice = (v: number) => Number(v.toPrecision(2))

export function OneSpread({
  bars,
  whole,
  shown,
  median,
  log = false,
  selected,
  openEnds = true,
  onPick,
  format,
  noun,
  middle,
  zoom,
  marks = [],
  title,
  description,
  testId = "spread",
}: {
  bars: SpreadBar[]
  /** The whole Spread's ends, zoomed or not; `null` where there is no whole. */
  whole: Range | null
  /** The ends the bars span now. */
  shown: Range
  median?: number
  log?: boolean
  /** What the bound keeps, drawn solid; `null` for nothing. */
  selected: { min?: number; max?: number } | null
  /** Whether a run touching an end of the whole leaves that end open. */
  openEnds?: boolean
  onPick: (pick: Pick) => void
  format: (value: number, shownSpan: number) => string
  /** What a bar counts, plural. */
  noun: string
  /** The caption's middle while nothing is hovered; the median by default. */
  middle?: string
  zoom?: ZoomKit
  /** Dashed lines over the bars, such as the Requests tab's tier edges. */
  marks?: { at: number; label: string }[]
  /** Full screen's heading and line under it. */
  title: string
  description?: ReactNode
  testId?: string
}) {
  const [full, setFull] = useState(false)
  const view = {
    bars,
    whole,
    shown,
    median,
    log,
    selected,
    openEnds,
    onPick,
    format,
    noun,
    middle,
    zoom,
    marks,
    testId,
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
            <DialogTitle className="text-sm">{title}</DialogTitle>
            <DialogDescription className="text-[11px]">
              {description && <>{description} </>}Drag across the bars to pick a
              range
              {zoom?.pan ? ", scroll to move along it" : ""}.
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

type View = Omit<
  React.ComponentProps<typeof OneSpread>,
  "title" | "description"
> & { marks: { at: number; label: string }[]; testId: string }

function SpreadView({
  tall = false,
  onFullScreen,
  ...view
}: View & { tall?: boolean; onFullScreen: () => void }) {
  const wheelRef = useWheel(view.zoom)
  const barsId = useId()
  return (
    <div className={tall ? "flex h-full flex-col gap-2" : "space-y-1"}>
      <div className="flex items-center gap-1.5">
        <span className="flex-1" />
        {view.zoom && (
          <ZoomControls
            onIn={view.zoom.zoomIn}
            onOut={view.zoom.zoomOut}
            inDisabled={!view.zoom.canIn}
            outDisabled={!view.zoom.canOut}
          />
        )}
        <TgButton
          size="sm"
          variant="secondary"
          aria-label={
            tall ? "Leave the spread's full screen" : "Spread full screen"
          }
          title={tall ? "Leave full screen" : "Watch the spread full screen"}
          onClick={onFullScreen}
        >
          {tall ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </TgButton>
      </div>
      <div
        id={barsId}
        ref={wheelRef}
        className={`relative ${tall ? "min-h-0 flex-1 [&_[role=presentation]]:h-[calc(92vh-9rem)]" : ""}`}
      >
        <Marks {...view} tall={tall} />
        <Bars {...view} />
      </div>
      {view.zoom?.thumb && view.zoom.moveTo && (
        <Scrollbar
          controls={barsId}
          thumb={view.zoom.thumb}
          moveTo={view.zoom.moveTo}
          pan={view.zoom.pan}
        />
      )}
    </div>
  )
}

function Bars({
  bars,
  whole,
  shown,
  median,
  log,
  selected,
  openEnds,
  onPick,
  format,
  noun,
  middle,
  testId,
}: View) {
  const write = (v: number) => format(v, shown[1] - shown[0])
  const onSelect = (run: Run) => {
    const s = Math.min(run.from, run.to)
    const t = Math.max(run.from, run.to)
    const atStart = !!openEnds && !!whole && s === 0 && shown[0] <= whole[0]
    const atEnd =
      !!openEnds && !!whole && t === bars.length - 1 && shown[1] >= whole[1]
    onPick({
      min: atStart ? undefined : bars[s].lo,
      max: atEnd ? undefined : bars[t].hi,
      all: atStart && atEnd,
      run: { from: s, to: t },
    })
  }
  return (
    <BarHistogram
      testId={testId}
      bins={bars.map((b) => b.count)}
      solid={(i) =>
        !!selected &&
        (selected.min === undefined || bars[i].hi > selected.min) &&
        (selected.max === undefined || bars[i].lo < selected.max)
      }
      onSelect={onSelect}
      caption={(bar) => [
        write(shown[0]),
        bar === null
          ? (middle ??
            (median === undefined
              ? "drag to pick"
              : `median ${write(median)}${log ? ", log scale" : ""}`))
          : `${bars[bar].count.toLocaleString()} ${noun}, ${write(bars[bar].lo)}–${write(bars[bar].hi)}`,
        write(shown[1]),
      ]}
    />
  )
}

function Marks({ marks, shown, tall }: View & { tall: boolean }) {
  const [lo, hi] = shown
  return marks
    .filter((m) => m.at > lo && m.at < hi)
    .map((m) => (
      <div
        key={m.label}
        aria-hidden
        className="pointer-events-none absolute z-10 border-l border-dashed border-fuchsia-500/70"
        style={{
          left: `${(100 * (m.at - lo)) / (hi - lo)}%`,
          height: tall ? "calc(92vh - 9rem)" : "4rem",
        }}
      >
        <span className="absolute -top-3.5 left-0.5 whitespace-nowrap text-[9px] text-fuchsia-600 dark:text-fuchsia-300">
          {m.label}
        </span>
      </div>
    ))
}

function Scrollbar({
  controls,
  thumb,
  moveTo,
  pan,
}: {
  controls: string
  thumb: { left: number; width: number }
  moveTo: (left: number) => void
  pan?: (fraction: number) => void
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    // A quarter of what is shown, per arrow key.
    const step = { ArrowLeft: -0.25, ArrowRight: 0.25 }[e.key]
    if (!step || !pan) return
    e.preventDefault()
    // Or a keyboard shortcut outside the popover takes the same arrow.
    e.stopPropagation()
    pan(step)
  }
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = e.currentTarget.parentElement as HTMLElement
    const [x0, left0] = [e.clientX, thumb.left]
    const onMove = (m: PointerEvent) =>
      moveTo((left0 + (100 * (m.clientX - x0)) / track.clientWidth) / 100)
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
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
        aria-controls={controls}
        aria-valuenow={Math.round(thumb.left)}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 cursor-grab touch-none rounded-full bg-app-ink/40 hover:bg-app-ink/60 active:cursor-grabbing"
        // A long history makes a thin thumb; 8px stays grabbable, kept inside.
        style={{
          left: `min(${thumb.left}%, calc(100% - 8px))`,
          width: `${thumb.width}%`,
          minWidth: 8,
        }}
      />
    </div>
  )
}

/** The wheel or a trackpad swipe over the bars pans, while anything can move. */
function useWheel(zoom?: ZoomKit) {
  const ref = useRef<HTMLDivElement>(null)
  const panRef = useRef(zoom?.pan)
  panRef.current = zoom?.pan
  const canPan = !!zoom?.pan
  useEffect(() => {
    const el = ref.current
    if (!el || !canPan) return
    // Not passive: a scroll that moves the spread must not scroll the popover.
    const onWheel = (e: WheelEvent) => {
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!delta) return
      e.preventDefault()
      panRef.current?.(delta / el.clientWidth)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [canPan])
  return ref
}
