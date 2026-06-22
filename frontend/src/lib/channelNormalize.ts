import type { Channel } from "../types"

/** Normalize API/IndexedDB channel records for UI consumption. */
export function normalizeChannel(c: Channel): Channel {
  return {
    ...c,
    tags: Array.isArray(c.tags) ? c.tags : [],
    startId:
      c.startId != null ? c.startId : c.startTime != null ? undefined : 1,
  }
}
