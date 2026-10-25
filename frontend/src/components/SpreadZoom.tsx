/**
 * Zoom on a Spread (TB-04, ADR-037): two adapters behind one seam, the
 * `ZoomKit` the Spread draws its zoom row, scrollbar and panning from.
 *
 * A range inside the whole Spread, for every bound. A spread starts whole.
 * Zoom in shows a third of what is shown, centred on the bound (its middle,
 * or its one end) or else the median, clamped inside the whole spread; Zoom
 * out triples the span around its middle until the whole spread is back. On
 * a log scale the thirds are taken in log(1 + x), so a step means the same on
 * both scales, and panning moves in the same space.
 *
 * An extent around the Analysis window, which has no whole Spread: three
 * times the window, tripled per step, panned in time between the oldest
 * stored Post and now.
 */
import { useEffect, useRef, useState } from "react"
import { floorToMinute, MINUTE_MS } from "@/lib/analysis-window"
import type { Range } from "@/lib/spread"

/** The range shown, `null` for the whole spread; whoever bins the bars keeps it. */
export type ZoomState = {
  range: Range | null
  setRange: (next: Range | null) => void
}

/** What the Spread zooms and moves with, from either adapter. */
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

/** A fresh zoom: whole, and whole again each time the editor opens. */
export function useZoomState(): ZoomState {
  const [range, setRange] = useState<Range | null>(null)
  return { range, setRange }
}

/** Six steps at most: 1/729 of the whole spread. */
const MAX_STEPS = 6

/** How long a server-drawn Spread waits after the last pan before it reads. */
export const SETTLE_MS = 150

/** What the zoom is over, and what it centres on. */
export type Spreading = {
  lo: number
  hi: number
  log: boolean
  median: number
  bound: { min?: number; max?: number; none?: boolean } | null
}

/** A bound's middle, or its one end; `undefined` with none. */
function boundFocus(bound: Spreading["bound"]): number | undefined {
  if (!bound || bound.none) return undefined
  if (bound.min !== undefined && bound.max !== undefined)
    return (bound.min + bound.max) / 2
  return bound.min ?? bound.max
}

/**
 * Holds a moving position for the thumb and commits it `wait` ms after the
 * last move, so a swipe over a server-drawn Spread reads once. With no wait
 * it commits at once. `cancel` drops a move not yet committed, so a zoom
 * pressed inside the wait is not overwritten by it.
 */
function useSettled<T>(commit: (next: T) => void, wait: number) {
  const [pending, setPending] = useState<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const settle = (next: T) => {
    if (!wait) return commit(next)
    setPending(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      commit(next)
      setPending(null)
    }, wait)
  }
  const cancel = () => {
    clearTimeout(timer.current)
    if (pending !== null) setPending(null)
  }
  return [pending, settle, cancel] as const
}

/**
 * Adapter one: a range inside the whole Spread, which a scrollbar moves
 * between known ends. `settle` waits that long after the last pan before
 * committing the range a server-drawn Spread reads; the thumb moves at once.
 */
export function useRangeZoomKit(
  zoom: ZoomState,
  { lo, hi, log, median, bound }: Spreading,
  settle = 0,
): ZoomKit {
  const [pending, move, cancel] = useSettled<Range>(zoom.setRange, settle)
  const [f, inv] =
    log && lo >= 0
      ? [Math.log1p, Math.expm1]
      : [(x: number) => x, (x: number) => x]
  const [A, B] = [f(lo), f(hi)]
  const whole = B - A
  const shown = pending ?? zoom.range
  const [a, b] = shown ? [f(shown[0]), f(shown[1])] : [A, B]
  const span = b - a
  // The ends come back exact at a clamp, so a bar there still reaches them.
  const place = (start: number, width: number): Range => {
    const s = Math.min(Math.max(start, A), B - width)
    return [s === A ? lo : inv(s), s === B - width ? hi : inv(s + width)]
  }
  const centred = (centre: number, width: number) =>
    width >= whole * (1 - 1e-9) ? null : place(centre - width / 2, width)
  return {
    zoomIn: () => {
      cancel()
      zoom.setRange(centred(f(boundFocus(bound) ?? median), span / 3))
    },
    zoomOut: () => {
      cancel()
      zoom.setRange(centred((a + b) / 2, span * 3))
    },
    canIn: whole > 0 && span / whole > 3 ** -MAX_STEPS * (1 + 1e-6),
    canOut: zoom.range !== null,
    pan: shown
      ? (fraction) => move(place(a + fraction * span, span))
      : undefined,
    thumb:
      shown && whole > 0
        ? { left: (100 * (a - A)) / whole, width: (100 * span) / whole }
        : null,
    moveTo: (left) => move(place(A + left * whole, span)),
  }
}

/**
 * Adapter two: the Analysis window chart's extent. Three times the window,
 * times three again per zoom step, centred on the window and slid back so it
 * never reaches past now; panning slides it in time, never past now and
 * never back past the oldest stored Post, and settles before the read. Whole
 * minutes, as the window histogram refuses a fractional extent. A new
 * `anchor`, what the window is, drops the pan, so a window moved by a pick
 * or a field is centred again; a Live window's anchor ignores the clock.
 */
export function useExtentZoomKit({
  start,
  end,
  now,
  oldest,
  anchor = `${start}:${end}`,
}: {
  start: number
  end: number
  now: number
  /** The oldest stored Post of the selected Channels; `null` when unknown. */
  oldest: number | null
  anchor?: string
}) {
  const [zoom, setZoom] = useState(0)
  const [offset, setOffset] = useState(0)
  const [pending, move, cancel] = useSettled<number>(setOffset, SETTLE_MS)
  const [anchored, setAnchored] = useState(anchor)
  if (anchored !== anchor) {
    setAnchored(anchor)
    setOffset(0)
    cancel()
  }
  const span = Math.max(end - start, MINUTE_MS) * 3 * 3 ** zoom
  const baseEnd = Math.min(floorToMinute((start + end) / 2 + span / 2), now)
  const baseStart = baseEnd - span
  const floor = oldest === null ? -Infinity : Math.min(oldest - baseStart, 0)
  const clamp = (o: number) =>
    Math.round(Math.max(Math.min(o, now - baseEnd), floor) / MINUTE_MS) *
    MINUTE_MS
  const at = clamp(offset)
  const moving = clamp(pending ?? offset)
  const whole = oldest === null ? 0 : now - oldest
  const kit: ZoomKit = {
    canIn: zoom > 0,
    canOut: true,
    zoomIn: () => {
      cancel()
      setZoom(zoom - 1)
    },
    zoomOut: () => {
      cancel()
      setZoom(zoom + 1)
    },
    pan: (fraction) => move(clamp(moving + fraction * span)),
    thumb:
      oldest !== null && whole > span
        ? {
            left: Math.max(0, (100 * (baseStart + moving - oldest)) / whole),
            width: (100 * span) / whole,
          }
        : null,
    moveTo: (left) =>
      oldest !== null && move(clamp(oldest + left * whole - baseStart)),
  }
  return { extent: [baseStart + at, baseEnd + at] as Range, kit }
}
