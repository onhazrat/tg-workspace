import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getDBStats } from "@/lib/repository"
import type { DBStats } from "@/types"

import { queryKeys } from "./queryKeys"

/**
 * Database counts for the diagnostics panels.
 *
 * **`enabled: false` on purpose.** These are only ever wanted when a settings
 * panel that shows them is open, and `SettingsHub`/`MigrationPrompt` fetch them
 * imperatively via `useLoadDBStats()` when that happens. Unlike the log panels
 * in G2.1 there is nothing here that writes stats, so nothing invalidates and
 * the disabled-query trap does not apply — the imperative load *is* the only
 * trigger, by design.
 *
 * Extracted from `DataContext` in G2.3; same query, same key.
 */
export function useDBStatsQuery() {
  return useQuery({
    queryKey: queryKeys.dbStats,
    queryFn: () => getDBStats(),
    enabled: false,
  })
}

/** The stats, or `null` before the first load. */
export function useDBStats(): DBStats | null {
  return useDBStatsQuery().data ?? null
}

/**
 * Fetch the stats now and put them in the cache.
 *
 * `fetchQuery` rather than `invalidateQueries`, because the query is disabled
 * and an invalidation would mark it stale without ever refetching it.
 */
export function useLoadDBStats() {
  const queryClient = useQueryClient()
  return async () => {
    const stats = await getDBStats()
    queryClient.setQueryData(queryKeys.dbStats, stats)
  }
}
