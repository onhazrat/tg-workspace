import { Bot, CheckCircle2, ExternalLink, FileText, Send } from "lucide-react"
import type React from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import type { PublishLog } from "@/types"
import { LogCard, LogMetaItem } from "./LogCard"
import { DeleteLogButton, ExpandToggleButton } from "./LogCardActions"
import {
  ExpandableLogDetails,
  LogErrorBlock,
  RequestResponsePanels,
  TextDetailBlock,
} from "./LogDetailBlocks"
import { LogEmptyState } from "./LogEmptyState"

interface PublishLogsTabProps {
  logs: PublishLog[]
  visibleCount: number
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onDelete: (id: string) => void
  onViewSummary: (summaryId: string) => void
}

export const PublishLogsTab: React.FC<PublishLogsTabProps> = ({
  logs,
  visibleCount,
  expandedId,
  onToggleExpand,
  onDelete,
  onViewSummary,
}) => {
  if (logs.length === 0) {
    return <LogEmptyState message="No publish logs found" />
  }

  return (
    <>
      {logs.slice(0, visibleCount).map((log) => (
        <LogCard
          key={log.id}
          status={log.status}
          accent="green"
          successIcon={<CheckCircle2 size={16} />}
          title={
            log.status === "success"
              ? "Published Successfully"
              : "Publish Failed"
          }
          timestamp={log.timestamp}
          meta={
            <>
              <LogMetaItem icon={<Bot size={10} />}>
                Bot: {log.botName}
              </LogMetaItem>
              <LogMetaItem icon={<Send size={10} />}>
                Dest: {log.chatName} ({log.chatId})
              </LogMetaItem>
            </>
          }
          actions={
            <>
              <ExpandToggleButton
                expanded={expandedId === log.id}
                onClick={() => onToggleExpand(log.id)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onViewSummary(log.summaryId)}
                    className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
                  >
                    <ExternalLink size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View Summary in History</p>
                </TooltipContent>
              </Tooltip>
              <DeleteLogButton onClick={() => onDelete(log.id)} />
            </>
          }
        >
          {log.status === "failed" && log.error && (
            <LogErrorBlock error={log.error} topMargin />
          )}

          <div className="mt-3 pt-3 border-t border-app-ink/5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[8px] font-bold uppercase opacity-40">
                Summary ID:
              </span>
              <span className="text-[8px] font-mono opacity-60">
                {log.summaryId}
              </span>
            </div>
          </div>

          <ExpandableLogDetails expanded={expandedId === log.id}>
            {log.textSent && (
              <TextDetailBlock icon={<FileText size={10} />} label="Text Sent">
                {log.textSent}
              </TextDetailBlock>
            )}
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
