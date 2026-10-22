/**
 * The Operator's Requests tab (RQS-03, ADR-035): where every Request to
 * Telegram went. Loaded lazily from `App`, so its code downloads only when
 * the tab opens. The tab-wide state lives here, as one `RequestsFilter`.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { requestsReadRequestBreakdown } from "@/client"
import { useSettingsRegistry } from "@/components/settings-page/registry"
import { queryKeys } from "@/hooks/queryKeys"
import { useIsMobile } from "@/hooks/useMobile"
import {
  type ChargedFilter,
  chargedCounts,
  initialRequestsFilter,
  type RequestsFilter,
  requestsRange,
} from "@/lib/requests/breakdown"
import { offeredTab } from "@/lib/workspace-tabs"
import { RequestsView } from "./RequestsView"

function useBreakdown(
  range: { start: number; end: number },
  charged: ChargedFilter,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.requestBreakdown(range.start, range.end, charged),
    queryFn: () =>
      requestsReadRequestBreakdown({
        query: {
          start: new Date(range.start).toISOString(),
          end: new Date(range.end).toISOString(),
          charged,
        },
      }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** Only the Operator reads the Breakdown; anyone else is told so. */
export default function RequestsTab() {
  const registry = useSettingsRegistry()
  if (registry.isLoading)
    return <p className="text-sm text-app-ink/50">Loading…</p>
  if (!offeredTab("requests", registry.permissions))
    return (
      <p className="text-sm text-app-ink/60" data-testid="requests-refused">
        The Requests tab is for the Operator.
      </p>
    )
  return <OperatorRequests />
}

function OperatorRequests() {
  const [filter, setFilter] = useState<RequestsFilter>(initialRequestsFilter)
  // A live range reads the clock when it is picked, not on every render.
  const range = useMemo(
    () => requestsRange(filter.bound, Date.now()),
    [filter.bound],
  )
  // The unfiltered Breakdown gives the choice counts; the picked one, the rest.
  const all = useBreakdown(range, "all", true)
  const picked = useBreakdown(range, filter.charged, filter.charged !== "all")
  const shown = filter.charged === "all" ? all : picked
  const phone = useIsMobile()
  return (
    <RequestsView
      filter={filter}
      onFilter={(patch) => setFilter((f) => ({ ...f, ...patch }))}
      range={range}
      counts={all.data && chargedCounts(all.data.byKind)}
      breakdown={shown.data}
      error={all.error ?? shown.error}
      phone={phone}
    />
  )
}
