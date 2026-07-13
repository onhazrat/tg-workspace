import { Activity, Clock, Globe, RefreshCw } from "lucide-react"
import type React from "react"
import { networkConnectionLabel } from "@/lib/logs/format"
import type { NetworkLog } from "@/types"
import { LogCard, LogMetaItem } from "./LogCard"
import { DeleteLogButton, ExpandToggleButton } from "./LogCardActions"
import {
  ExpandableLogDetails,
  JsonDetailPanel,
  LogErrorBlock,
} from "./LogDetailBlocks"
import { LogEmptyState } from "./LogEmptyState"

interface NetworkLogsTabProps {
  logs: NetworkLog[]
  visibleCount: number
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onDelete: (id: string) => void
}

export const NetworkLogsTab: React.FC<NetworkLogsTabProps> = ({
  logs,
  visibleCount,
  expandedId,
  onToggleExpand,
  onDelete,
}) => {
  if (logs.length === 0) {
    return <LogEmptyState message="No network logs found" />
  }

  return (
    <>
      {logs.slice(0, visibleCount).map((log) => (
        <LogCard
          key={log.id}
          status={log.status}
          accent="teal"
          successIcon={<Globe size={16} />}
          title={log.status === "success" ? "Network Request" : "Network Error"}
          timestamp={log.timestamp}
          meta={
            <>
              <LogMetaItem icon={<Activity size={10} />}>
                {log.method}
              </LogMetaItem>
              <LogMetaItem
                icon={<Globe size={10} />}
                spanClassName="truncate max-w-[200px]"
              >
                {log.url}
              </LogMetaItem>
              {log.duration && (
                <LogMetaItem icon={<Clock size={10} />}>
                  {log.duration}ms
                </LogMetaItem>
              )}
              <LogMetaItem icon={<Activity size={10} />}>
                {networkConnectionLabel(log.proxyUsed)}
              </LogMetaItem>
              {log.attempts && log.attempts > 1 && (
                <LogMetaItem icon={<RefreshCw size={10} />}>
                  {log.attempts} tries
                </LogMetaItem>
              )}
            </>
          }
          actions={
            <>
              <ExpandToggleButton
                expanded={expandedId === log.id}
                onClick={() => onToggleExpand(log.id)}
              />
              <DeleteLogButton onClick={() => onDelete(log.id)} />
            </>
          }
        >
          <ExpandableLogDetails expanded={expandedId === log.id}>
            {log.telemetry && (
              <JsonDetailPanel label="Telemetry Data" value={log.telemetry} />
            )}
            {log.error && <LogErrorBlock error={log.error} />}
          </ExpandableLogDetails>
        </LogCard>
      ))}
    </>
  )
}
