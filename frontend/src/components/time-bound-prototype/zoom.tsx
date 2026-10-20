/**
 * PROTOTYPE (time-bound): zooming a spread, with the Posts tab's buttons.
 *
 * A spread starts whole. Zoom in shows a third of what is shown, centred on
 * the bound (or the median when there is none); zoom out triples it again
 * until the whole spread is back. On a log axis the thirds are taken in
 * log(1 + x), so a step means the same on both scales.
 */
import { ZoomControls } from "@/components/AnalysisWindowControl"

export type Range = [number, number]

/** How far in a spread can go: six steps, 1/729 of the whole. */
const MAX_STEPS = 6

const axis = (log: boolean) =>
  log
    ? { f: Math.log1p, inv: Math.expm1 }
    : { f: (x: number) => x, inv: (x: number) => x }

export type SpreadZoom = {
  /** What to bin: `null` is the whole spread. */
  range: Range | null
  zoomIn: () => void
  zoomOut: () => void
  canIn: boolean
  canOut: boolean
}

/** A bound's middle, or its one end, as what a zoom centres on. */
export function boundFocus(
  bound: { min?: number; max?: number; none?: boolean } | null | undefined,
): number | undefined {
  if (!bound || bound.none) return undefined
  if (bound.min !== undefined && bound.max !== undefined)
    return (bound.min + bound.max) / 2
  return bound.min ?? bound.max
}

/**
 * The zoom over `[lo, hi]`, controlled: the caller keeps `range`, because the
 * caller is who asks the server for the bars.
 */
export function spreadZoom({
  lo,
  hi,
  log,
  focus,
  range,
  setRange,
}: {
  lo: number
  hi: number
  log: boolean
  focus: number | undefined
  range: Range | null
  setRange: (next: Range | null) => void
}): SpreadZoom {
  const { f, inv } = axis(log && lo >= 0)
  const [A, B] = [f(lo), f(hi)]
  const [a, b] = range ? [f(range[0]), f(range[1])] : [A, B]
  const whole = B - A
  const span = b - a
  const place = (centre: number, width: number): Range | null => {
    if (width >= whole) return null
    const start = Math.min(Math.max(centre - width / 2, A), B - width)
    return [inv(start), inv(start + width)]
  }
  const focused = focus === undefined ? undefined : f(focus)
  const centre =
    focused !== undefined && focused >= a && focused <= b
      ? focused
      : (a + b) / 2
  return {
    range,
    zoomIn: () => setRange(place(centre, span / 3)),
    zoomOut: () => setRange(place((a + b) / 2, span * 3)),
    canIn: whole > 0 && span / whole > 3 ** -MAX_STEPS + 1e-9,
    canOut: range !== null,
  }
}

/** The row above a spread: the zoom, right-aligned as on the Posts chart. */
export function SpreadZoomBar({ zoom }: { zoom: SpreadZoom }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex-1" />
      <ZoomControls
        onIn={zoom.zoomIn}
        onOut={zoom.zoomOut}
        inDisabled={!zoom.canIn}
        outDisabled={!zoom.canOut}
      />
    </div>
  )
}
