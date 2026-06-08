/**
 * Hybrid sync: API-first with IndexedDB cache (read-through).
 */

import { api } from "../api/client";
import * as cache from "./db";

let syncMeta: Record<string, { etag: string }> = {};

export async function refreshSyncMeta(): Promise<void> {
  try {
    syncMeta = await api.syncMeta();
  } catch {
    /* server unavailable — use cache only */
  }
}

export async function getPostsByDateRangeCached(
  channelNames: string[],
  startDate: number,
  endDate: number
) {
  await refreshSyncMeta();
  return cache.getPostsByDateRange(channelNames, startDate, endDate);
}

export async function saveSummarySynced(summary: Parameters<typeof cache.saveSummary>[0]) {
  await cache.saveSummary(summary);
  try {
    await fetch(`${import.meta.env.VITE_API_URL || ""}/api/v1/data/summaries/${summary.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summary),
    });
  } catch {
    /* cached locally; sync when server available */
  }
}

export { cache };
