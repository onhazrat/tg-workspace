import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Activity, RefreshCw } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useCallback, useMemo } from "react"
import { api } from "@/api"
import { queryKeys } from "@/hooks/queryKeys"
import { useNetworkLogsQuery } from "@/hooks/useLogs"
import type { NetworkLog } from "../types"
import {
  ProxyHealthMatrix,
  RoutingDistribution,
  TelemetryStatCards,
  TorTelemetry,
} from "./network-telemetry/TelemetrySections"
import { telemetryStats } from "./network-telemetry/telemetry-model"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

const EMPTY_LOGS: NetworkLog[] = []
const TELEMETRY_REFRESH_MS = 10000

export const NetworkTelemetry: React.FC = () => {
  // TanStack Query de-duplicates across consumers and owns the poll timer, so
  // this component no longer runs its own fetch loop.
  const { data: logs = EMPTY_LOGS, isLoading: logsLoading } =
    useNetworkLogsQuery(true, { refetchInterval: TELEMETRY_REFRESH_MS })

  const { data: torStatus = null } = useQuery({
    queryKey: queryKeys.torStatus,
    queryFn: () => api.torStatus(),
    refetchInterval: TELEMETRY_REFRESH_MS,
  })

  const loading = logsLoading

  const queryClient = useQueryClient()
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.logs.network })
    queryClient.invalidateQueries({ queryKey: queryKeys.torStatus })
  }, [queryClient])

  const stats = useMemo(() => telemetryStats(logs), [logs])

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full opacity-50">
        <RefreshCw className="animate-spin w-6 h-6" />
      </div>
    )
  }

  return (
    <motion.div
      key="telemetry"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="bg-app-card p-8 border border-app-ink/10 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div className="text-left">
            <h3 className="text-sm uppercase font-bold tracking-widest flex items-center gap-2">
              <Activity size={14} className="opacity-40" /> Network Telemetry
            </h3>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              Monitor connection health, proxy performance, and Tor status.
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={refresh}
                className="p-2 hover:bg-app-ink/5 rounded-full transition-colors opacity-60 hover:opacity-100"
              >
                <RefreshCw size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Refresh Data</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <TelemetryStatCards stats={stats} torStatus={torStatus} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <RoutingDistribution stats={stats} />
          <TorTelemetry torStatus={torStatus} torRequests={stats.torRequests} />
        </div>

        <ProxyHealthMatrix rows={stats.proxyMatrix} />
      </div>
    </motion.div>
  )
}
