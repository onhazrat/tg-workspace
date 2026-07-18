import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { getDBStats, listPublishLogs, listSyncLogs } from "@/lib/repository"

import { queryKeys } from "./queryKeys"

/** Load heavy diagnostics data only when settings / history tabs are opened. */
export function useLazyTabData(activeTab: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (activeTab === "settings") {
      void queryClient.prefetchQuery({
        queryKey: queryKeys.dbStats,
        queryFn: () => getDBStats(),
        staleTime: 30_000,
      })
    }
  }, [activeTab, queryClient])

  useEffect(() => {
    if (activeTab === "history" || activeTab === "settings") {
      void queryClient.prefetchQuery({
        queryKey: queryKeys.logs.publish,
        queryFn: () => listPublishLogs(),
        staleTime: 30_000,
      })
      void queryClient.prefetchQuery({
        queryKey: queryKeys.logs.sync,
        queryFn: () => listSyncLogs(),
        staleTime: 30_000,
      })
    }
  }, [activeTab, queryClient])
}
