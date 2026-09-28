import type { CardZoom } from "./card-zoom"

/**
 * Column count for the channel grid at a given container width.
 *
 * Mirrors the Tailwind classes the grid was styled with
 * (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). Virtualization
 * needs the count as a number — each virtual row holds `lanes` cards — so the
 * breakpoints have to live somewhere JavaScript can read them. Kept beside the
 * grid and unit-tested so the two cannot silently diverge.
 */

/** Tailwind's default breakpoints, in pixels. */
const MD = 768
const LG = 1024
const XL = 1280

/** The most columns at zoom 0; other zoom levels derive theirs from card width. */
export const MAX_GRID_LANES = 4

/** The grid's `gap-4`, shared with the virtualised grid that renders it. */
export const GAP_PX = 16

/** Narrowest a card may get at each zoom level other than 0. Tuned by eye. */
const MIN_CARD_WIDTH_PX: Record<Exclude<CardZoom, 0>, number> = {
  1: 360,
  [-1]: 220,
  [-2]: 72,
}

export function gridLanesForWidth(width: number, zoom: CardZoom = 0): number {
  if (zoom === 0) return normalLanes(width)
  const cell = MIN_CARD_WIDTH_PX[zoom] + GAP_PX
  const lanes = Math.max(1, Math.floor((width + GAP_PX) / cell))
  // Detailed cards exist to show more, so they never get narrower than normal.
  return zoom > 0 ? Math.min(lanes, normalLanes(width)) : lanes
}

function normalLanes(width: number): number {
  if (width >= XL) return 4
  if (width >= LG) return 3
  if (width >= MD) return 2
  return 1
}
