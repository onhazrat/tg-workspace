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
import {
  jobsGetRuntimeConfig,
  type RequestKind,
  type RequestKindSwitch,
  type RuntimeConfigResponse,
} from "@/client"
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
  kind: RequestKind,
): string | null {
  const found = switches.find((s) => s.kind === kind)
  return found && !found.enabled ? found.refusal : null
}

export function useKindRefusal(kind: RequestKind): string | null {
  return refusalOf(useRequestKinds(), kind)
}

/**
 * A control that starts work of `kind` is off while the kind is, or while
 * `off` says so, and is titled with the refusal.
 */
export function useKindGate(
  kind: RequestKind,
  off = false,
): { disabled: boolean; title: string | undefined } {
  const refusal = useKindRefusal(kind)
  return { disabled: off || !!refusal, title: refusal ?? undefined }
}

/** The same answer outside React, from what the cache holds now. */
export function kindRefusalNow(kind: RequestKind): string | null {
  const config = queryClient.getQueryData<RuntimeConfigResponse>(
    queryKeys.runtimeConfig,
  )
  return refusalOf(config?.requestKinds ?? NONE, kind)
}

type Gate = { disabled: boolean; reason?: string }

/**
 * A palette command's `disabled`, refused while `kind` is off so the palette
 * starts nothing the server would refuse, and otherwise `check`'s answer.
 */
export function gatedBy<C>(
  kind: RequestKind,
  check: (ctx: C) => Gate = () => ({ disabled: false }),
): (ctx: C) => Gate {
  return (ctx) => {
    const refusal = kindRefusalNow(kind)
    return refusal ? { disabled: true, reason: refusal } : check(ctx)
  }
}

/** After a switch is written: every greyed action reads it again. */
export function refreshRequestKinds(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.runtimeConfig })
}
