/**
 * A Time bound (TB-01, ADR-033): `[start, end)`, either end open. A Live end
 * is signed ms from now, negative for the past; a Fixed end is epoch ms.
 */
import type { WindowMode } from "@/lib/scope/window"

export type TimeBound = { mode: WindowMode; start?: number; end?: number }

/** What a filter turns on in the one editor. */
export type TimeBoundOptions = {
  /** Either end may be left open (blank). */
  openEnds?: boolean
  /** A Live end may point ahead of now (a negative End gap). */
  ahead?: boolean
}
