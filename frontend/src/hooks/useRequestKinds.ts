/**
 * Which Request kinds the Operator has disabled (RKD-02, ADR-040), from the
 * runtime config. The UI greys out what a disabled kind would start, with the
 * server's own refusal as the reason; the server's refusal stays the authority.
 *
 * Reads through the app's `queryClient` rather than the provider's, so a
 * channel card or a button rendered with props only (their unit tests have no
 * provider) still asks. Signed out, it asks nothing.
 */
import { useQuery } from "@tanstack/react-query"
import { jobsGetRuntimeConfig, type RequestKindSwitch } from "@/client"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import { hasSession } from "@/lib/storage/scoped"

const NONE: RequestKindSwitch[] = []

export function useRequestKinds(): RequestKindSwitch[] {
  const query = useQuery(
    {
      queryKey: queryKeys.runtimeConfig,
      queryFn: () => jobsGetRuntimeConfig(),
      select: (config) => config.requestKinds ?? NONE,
      staleTime: 30_000,
      enabled: hasSession(),
    },
    queryClient,
  )
  return query.data ?? NONE
}

/** The refusal of a disabled kind, or null while it is on. */
export function refusalOf(
  switches: readonly RequestKindSwitch[],
  kind: string,
): string | null {
  const found = switches.find((s) => s.kind === kind)
  return found && !found.enabled ? found.refusal : null
}

export function useKindRefusal(kind: string): string | null {
  return refusalOf(useRequestKinds(), kind)
}

/** The same answer outside React, from what the cache holds now. */
export function kindRefusalNow(kind: string): string | null {
  const config = queryClient.getQueryData<{
    requestKinds?: RequestKindSwitch[]
  }>(queryKeys.runtimeConfig)
  return refusalOf(config?.requestKinds ?? NONE, kind)
}

/** After a switch is written: every greyed action reads it again. */
export function refreshRequestKinds(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.runtimeConfig })
}

/** "10:32": when a kind went off, as the panel and the Requests tab say it. */
export function sinceLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
