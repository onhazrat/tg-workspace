import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { queryKeys } from "./queryKeys"
import { fetchLogs } from "./useLogs"

/** Load heavy diagnostics data only when the tools / history tabs are opened. */
export function useLazyTabData(activeTab: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (activeTab === "history" || activeTab === "tools") {
      // `fetchLogs`, not a bare list call: these write the *same* query keys as
      // `useLogsQuery`, and prefetching unsorted data meant the publish and
      // sync panels rendered in whatever order the server returned whenever the
      // prefetch won the race.
      void queryClient.prefetchQuery({
        queryKey: queryKeys.logs.publish,
        queryFn: () => fetchLogs("publish"),
        staleTime: 30_000,
      })
      void queryClient.prefetchQuery({
        queryKey: queryKeys.logs.sync,
        queryFn: () => fetchLogs("sync"),
        staleTime: 30_000,
      })
    }
  }, [activeTab, queryClient])
}
