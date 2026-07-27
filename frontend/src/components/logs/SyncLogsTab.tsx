import { Activity, Clock, Hash, RefreshCw } from "lucide-react"
import type React from "react"
import type { SyncLog } from "@/types"
import { LogCard, LogMetaItem } from "./LogCard"
import { DeleteLogButton, ExpandToggleButton } from "./LogCardActions"
import {
  ExpandableLogDetails,
  LogErrorBlock,
  RequestResponsePanels,
} from "./LogDetailBlocks"
import { LogEmptyState } from "./LogEmptyState"
import { LogsSkeleton } from "./LogsSkeleton"

interface SyncLogsTabProps {
  logs: SyncLog[]
  /** First load in flight — distinct from having no logs. */
  isLoading: boolean
  visibleCount: number
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onDelete: (id: string) => void
}

export const SyncLogsTab: React.FC<SyncLogsTabProps> = ({
  logs,
  isLoading,
  visibleCount,
  expandedId,
  onToggleExpand,
  onDelete,
}) => {
  if (isLoading) {
    return <LogsSkeleton />
  }

  if (logs.length === 0) {
    return <LogEmptyState message="No sync logs found" />
  }

  return (
    <>
      {logs.slice(0, visibleCount).map((log) => (
        <LogCard
          key={log.id}
          status={log.status}
          accent="blue"
          successIcon={<RefreshCw size={16} />}
          title={log.status === "success" ? "Sync Successful" : "Sync Failed"}
          timestamp={log.timestamp}
          meta={
            <>
              <LogMetaItem icon={<Activity size={10} />}>
                Channel: @{log.channelName}
              </LogMetaItem>
              <LogMetaItem icon={<Clock size={10} />}>
                Source: {log.source}
              </LogMetaItem>
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
          {log.status === "success" && (
            <div className="mt-2 flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-[9px] font-mono opacity-60">
                <Hash size={10} />
                <span>New Posts: {log.postsCount}</span>
              </div>
              {log.newLatestId && (
                <div className="flex items-center gap-1.5 text-[9px] font-mono opacity-60">
                  <span className="font-bold uppercase">Latest ID:</span>
                  <span>{log.newLatestId}</span>
                </div>
              )}
            </div>
          )}

          {log.status === "failed" && log.error && (
            <LogErrorBlock error={log.error} topMargin />
          )}

          <ExpandableLogDetails expanded={expandedId === log.id}>
            <RequestResponsePanels
              request={log.fullRequest}
              response={log.fullResponse}
            />
          </ExpandableLogDetails>
        </LogCard>
      ))}
    </>
  )
}
