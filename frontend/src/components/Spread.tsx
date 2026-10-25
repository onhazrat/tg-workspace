/**
 * The one Spread (ADR-037): every bound's bars and the Analysis window
 * chart. A drag across the bars picks a run (a click is a one-bar run), the
 * caption names the hovered bar or the median, and around the bars sit the
 * zoom row, a scrollbar along a zoomed Spread, panning by wheel and arrow
 * keys, and full screen that keeps the zoom. It knows nothing of Channels,
 * Posts or bounds: a pick comes back in its own values and the caller turns
 * it into a bound. Zoom comes from an adapter in `SpreadZoom.tsx`; binning
 * from `lib/spread.ts`.
 */
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react"
import type React from "react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import type { ZoomKit } from "@/components/SpreadZoom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TgButton } from "@/components/ui/tg-button"
import { useFullScreen } from "@/hooks/useFullScreen"
import { formatCount } from "@/lib/format-count"
import type { Pick as Picked, Range, SpreadBar } from "@/lib/spread"

const DAY_MS = 86_400_000

/** A time spread's captions: dates, and the time of day once under three days show. */
export const dateText = (ms: number, shown = Number.POSITIVE_INFINITY) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(shown < 3 * DAY_MS && { timeStyle: "short" }),
  }).format(ms)

/** A spread the server draws: a Directory distribution, a log's, History's. */
export type SpreadData = Pick<
  DirectoryDistributionResponse,
  "bins" | "min" | "max" | "median"
> & { scale?: DirectoryDistributionResponse["scale"] }

type Mark = { at: number; label: string }

type SpreadProps = {
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
  onPick: (pick: Picked) => void
  /** Writes a value, told how wide a span is shown. */
  format: (value: number, shownSpan: number) => string
  /** What a bar counts, plural. */
  noun: string
  /** The caption's middle while nothing is hovered; the median by default. */
  middle?: string
  zoom?: ZoomKit
  /** Dashed lines over the bars, such as the Requests tab's tier edges. */
  marks?: Mark[]
  /** Full screen's heading, and the line under it. */
  title: string
  description?: ReactNode
  /** Prefixes the test ids, for two Spreads on one screen. */
  testId?: string
}

type View = Omit<SpreadProps, "title" | "description"> & {
  marks: Mark[]
  testId: string
}

export function Spread({
  title,
  description,
  marks = [],
  testId = "spread",
  ...props
}: SpreadProps) {
  const [full, setFull] = useFullScreen()
  const view: View = { ...props, marks, testId }
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
              range{props.zoom?.pan ? ", scroll to move along it" : ""}.
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
  const { zoom } = view
  const wheelRef = useWheel(zoom?.pan)
  const barsId = useId()
  const Icon = tall ? Minimize2 : Maximize2
  return (
    <div className={tall ? "flex h-full flex-col gap-2" : "space-y-1"}>
      <div className="flex items-center gap-1.5">
        <span className="flex-1" />
        {zoom && <ZoomControls zoom={zoom} />}
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
      <div
        id={barsId}
        ref={wheelRef}
        data-testid={`${view.testId}-bars`}
        className={`relative ${tall ? "min-h-0 flex-1" : ""}`}
      >
        <Marks {...view} tall={tall} />
        <Bars {...view} tall={tall} />
      </div>
      {zoom?.thumb && zoom.moveTo && (
        <Scrollbar
          controls={barsId}
          thumb={zoom.thumb}
          moveTo={zoom.moveTo}
          pan={zoom.pan}
        />
      )}
    </div>
  )
}

/** Zoom in and out, right-aligned above the bars. */
function ZoomControls({ zoom }: { zoom: ZoomKit }) {
  return (
    <>
      <TgButton
        size="sm"
        variant="secondary"
        aria-label="Zoom in"
        disabled={!zoom.canIn}
        onClick={zoom.zoomIn}
      >
        <ZoomIn size={13} />
      </TgButton>
      <TgButton
        size="sm"
        variant="secondary"
        aria-label="Zoom out"
        disabled={!zoom.canOut}
        onClick={zoom.zoomOut}
      >
        <ZoomOut size={13} />
      </TgButton>
    </>
  )
}

/**
 * The bars a drag picks a run from. A run touching the first or last bar
 * of the whole Spread leaves that end open, unless the zoom hides that edge
 * or open ends are refused; touching both is everything with a value.
 */
function Bars({
  bars,
  whole,
  shown,
  median,
  log,
  selected,
  openEnds = true,
  onPick,
  format,
  noun,
  middle,
  testId,
  tall,
}: View & { tall: boolean }) {
  const [drag, setDrag] = useState<Picked["run"] | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const write = (v: number) => format(v, shown[1] - shown[0])
  const peak = Math.max(...bars.map((b) => b.count))
  const end = () => {
    if (!drag) return
    setDrag(null)
    const s = Math.min(drag.from, drag.to)
    const t = Math.max(drag.from, drag.to)
    const open = openEnds && whole
    const atStart = !!open && s === 0 && shown[0] <= whole[0]
    const atEnd = !!open && t === bars.length - 1 && shown[1] >= whole[1]
    onPick({
      ...(!atStart && { min: bars[s].lo }),
      ...(!atEnd && { max: bars[t].hi }),
      all: atStart && atEnd,
      run: { from: s, to: t },
    })
  }
  const isSolid = (i: number) =>
    drag
      ? i >= Math.min(drag.from, drag.to) && i <= Math.max(drag.from, drag.to)
      : !!selected &&
        (selected.min === undefined || bars[i].hi > selected.min) &&
        (selected.max === undefined || bars[i].lo < selected.max)
  const lit = drag ? drag.to : hover
  return (
    <div className={tall ? "flex h-full flex-col gap-1" : "space-y-1"}>
      <div
        role="presentation"
        className={`flex cursor-crosshair touch-none select-none items-end gap-px rounded-md bg-app-ink/[0.03] px-0.5 ${tall ? "h-[calc(92vh-9rem)]" : "h-16"}`}
        onPointerUp={end}
        onPointerLeave={() => {
          setHover(null)
          end()
        }}
      >
        {bars.map((b, i) => (
          <div
            key={i}
            data-testid={`${testId}-bar-${i}`}
            data-solid={isSolid(i)}
            className={`flex-1 rounded-t-[2px] ${isSolid(i) ? "bg-app-ink/70" : "bg-app-ink/15"} ${lit === i ? "ring-1 ring-app-ink/60" : ""}`}
            style={{
              height: `${b.count === 0 ? 2 : Math.max(8, (b.count / peak) * 100)}%`,
            }}
            onPointerDown={(e) => {
              // A touch captures the pointer to the first bar, which would
              // keep every other bar from hearing the drag.
              if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId)
              setDrag({ from: i, to: i })
            }}
            onPointerEnter={() => {
              setHover(i)
              if (drag) setDrag({ ...drag, to: i })
            }}
          />
        ))}
      </div>
      <div
        data-testid={`${testId}-caption`}
        className="flex justify-between gap-2 text-[10px] tabular-nums text-app-ink/50"
      >
        <span>{write(shown[0])}</span>
        <span className="text-center">
          {lit === null
            ? (middle ??
              (median === undefined
                ? "drag to pick"
                : `median ${write(median)}${log ? ", log scale" : ""}`))
            : `${formatCount(bars[lit].count)} ${noun}, ${write(bars[lit].lo)}–${write(bars[lit].hi)}`}
        </span>
        <span>{write(shown[1])}</span>
      </div>
    </div>
  )
}

/** Marks over the bars, inside what they span; a drag passes through. */
function Marks({ marks, bars, tall }: View & { tall: boolean }) {
  if (!bars.length) return null
  const lo = bars[0].lo
  const hi = bars[bars.length - 1].hi
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
function useWheel(pan?: (fraction: number) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const panRef = useRef(pan)
  panRef.current = pan
  const canPan = !!pan
  useEffect(() => {
    const el = ref.current
    if (!el || !canPan) return
    // Not passive: a scroll that moves the spread must not scroll the popover.
    const onWheel = (e: WheelEvent) => {
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!delta || !el.clientWidth) return
      e.preventDefault()
      panRef.current?.(delta / el.clientWidth)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [canPan])
  return ref
}
