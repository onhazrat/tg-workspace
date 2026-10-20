/**
 * Zoom on a spread a bound is drawn over (TB-04), with the Posts time
 * chart's buttons. A spread starts whole. Zoom in shows a third of what is
 * shown, centred on the bound (its middle, or its one end) or else the
 * median, clamped inside the whole spread; Zoom out triples the span around
 * its middle until the whole spread is back. On a log scale the thirds are
 * taken in log(1 + x), so a step means the same on both scales.
 */
import { useState } from "react"
import { ZoomControls } from "@/components/AnalysisWindowControl"

export type Range = [number, number]

/** The range shown, `null` for the whole spread; whoever bins the bars keeps it. */
export type ZoomState = {
  range: Range | null
  setRange: (next: Range | null) => void
}

/** A fresh zoom: whole, and whole again each time the editor opens. */
export function useZoomState(): ZoomState {
  const [range, setRange] = useState<Range | null>(null)
  return { range, setRange }
}

/** Six steps at most: 1/729 of the whole spread. */
const MAX_STEPS = 6

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

export function spreadZoom(
  { lo, hi, log, median, bound }: Spreading,
  { range, setRange }: ZoomState,
) {
  const [f, inv] =
    log && lo >= 0
      ? [Math.log1p, Math.expm1]
      : [(x: number) => x, (x: number) => x]
  const [A, B] = [f(lo), f(hi)]
  const [a, b] = range ? [f(range[0]), f(range[1])] : [A, B]
  const whole = B - A
  const span = b - a
  // The ends come back exact at a clamp, so a bar there still reaches them.
  const place = (centre: number, width: number): Range | null => {
    if (width >= whole * (1 - 1e-9)) return null
    const start = Math.min(Math.max(centre - width / 2, A), B - width)
    return [
      start === A ? lo : inv(start),
      start === B - width ? hi : inv(start + width),
    ]
  }
  return {
    zoomIn: () => setRange(place(f(boundFocus(bound) ?? median), span / 3)),
    zoomOut: () => setRange(place((a + b) / 2, span * 3)),
    canIn: whole > 0 && span / whole > 3 ** -MAX_STEPS * (1 + 1e-6),
    canOut: range !== null,
  }
}

/** The row above a spread: the zoom, right-aligned as on the Posts chart. */
export function SpreadZoomBar({
  spreading,
  zoom,
}: {
  spreading: Spreading
  zoom: ZoomState
}) {
  const z = spreadZoom(spreading, zoom)
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex-1" />
      <ZoomControls
        onIn={z.zoomIn}
        onOut={z.zoomOut}
        inDisabled={!z.canIn}
        outDisabled={!z.canOut}
      />
    </div>
  )
}
