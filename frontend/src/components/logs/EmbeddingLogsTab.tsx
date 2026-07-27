import { Clock, FileText, Hash } from "lucide-react"
import type React from "react"
import type { EmbeddingLog } from "@/types"
import { LogCard, LogMetaItem } from "./LogCard"
import { DeleteLogButton, ExpandToggleButton } from "./LogCardActions"
import {
  ExpandableLogDetails,
  LogErrorBlock,
  TextDetailBlock,
} from "./LogDetailBlocks"
import { LogEmptyState } from "./LogEmptyState"
import { LogsSkeleton } from "./LogsSkeleton"

interface EmbeddingLogsTabProps {
  logs: EmbeddingLog[]
  /** First load in flight — distinct from having no logs. */
  isLoading: boolean
  visibleCount: number
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onDelete: (id: string) => void
}

export const EmbeddingLogsTab: React.FC<EmbeddingLogsTabProps> = ({
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
    return <LogEmptyState message="No embedding logs found" />
  }

  return (
    <>
      {logs.slice(0, visibleCount).map((log) => (
        <LogCard
          key={log.id}
          status={log.status}
          accent="orange"
          successIcon={<Hash size={16} />}
          title={
            log.status === "success"
              ? "Embedding Generation"
              : "Embedding Error"
          }
          timestamp={log.timestamp}
          meta={
            <>
              <LogMetaItem icon={<Hash size={10} />}>
                Tokens: {log.tokensEstimated || 0}
              </LogMetaItem>
              {log.duration && (
                <LogMetaItem icon={<Clock size={10} />}>
                  {log.duration}ms
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
            <TextDetailBlock
              icon={<FileText size={10} />}
              label="Input Details"
            >
              Texts embedded: {log.textCount}
            </TextDetailBlock>
            {log.error && <LogErrorBlock error={log.error} />}
          </ExpandableLogDetails>
        </LogCard>
      ))}
    </>
  )
}
