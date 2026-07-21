import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { api } from "@/api"

import { env } from "@/lib/env"

import { queryKeys } from "./queryKeys"

/**
 * Resolves to `false` rather than throwing: a failed health check is a normal
 * result (offline), not a query error. Throwing would leave `data` undefined
 * and the hook would report "online" while the backend was unreachable.
 */
async function fetchHealth(): Promise<boolean> {
  try {
    await api.healthCheck()
    return true
  } catch {
    return false
  }
}

/**
 * Shared backend health status.
 *
 * Backed by a single TanStack Query so all consumers share one request and one
 * value — previously each of the seven consumers mounted its own interval,
 * producing up to seven health checks per period and seven independently
 * drifting `isOffline` flags.
 */
export function useApiStatus() {
  const queryClient = useQueryClient()

  const { data: isOnline = true } = useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    refetchInterval: env.apiHealthPollMs,
    retry: false,
  })

  const checkHealth = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.health,
        queryFn: fetchHealth,
      }),
    [queryClient],
  )

  return { isOnline, isOffline: !isOnline, checkHealth }
}
