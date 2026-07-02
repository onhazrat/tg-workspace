import type { Channel } from "../types"
import { normalizeChannelTags } from "./channels/channel-tag-model"

/** Normalize API/IndexedDB channel records for UI consumption. */
export function normalizeChannel(c: Channel): Channel {
  return {
    ...c,
    tags: normalizeChannelTags(c.tags),
    startId:
      c.startId != null ? c.startId : c.startTime != null ? undefined : 1,
  }
}
