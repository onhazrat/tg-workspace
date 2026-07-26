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

export const MAX_GRID_LANES = 4

export function gridLanesForWidth(width: number): number {
  if (width >= XL) return 4
  if (width >= LG) return 3
  if (width >= MD) return 2
  return 1
}
