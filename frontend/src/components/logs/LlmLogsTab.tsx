import { Bot, Cpu, FileText, MessageSquare, Zap } from "lucide-react"
import type React from "react"
import type { LLMLog, LLMLogListItem } from "@/types"
import { LogCard, LogMetaItem } from "./LogCard"
import { DeleteLogButton, ExpandToggleButton } from "./LogCardActions"
import {
  ExpandableLogDetails,
  LogDetailSection,
  LogErrorBlock,
  RequestResponsePanels,
  TextDetailBlock,
} from "./LogDetailBlocks"
import { LogEmptyState } from "./LogEmptyState"
import { LogsSkeleton } from "./LogsSkeleton"

interface LlmLogsTabProps {
  logs: LLMLogListItem[]
  /** First load in flight — distinct from having no logs. */
  isLoading: boolean
  visibleCount: number
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onDelete: (id: string) => void
}

export const LlmLogsTab: React.FC<LlmLogsTabProps> = ({
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
    return <LogEmptyState message="No LLM logs found" />
  }

  return (
    <>
      {logs.slice(0, visibleCount).map((log) => (
        <LogCard
          key={log.id}
          status={log.status}
          accent="purple"
          successIcon={<Cpu size={16} />}
          title={log.status === "success" ? "LLM Interaction" : "LLM Error"}
          timestamp={log.timestamp}
          meta={
            <>
              <LogMetaItem icon={<Cpu size={10} />}>
                Model: {log.model}
              </LogMetaItem>
              <LogMetaItem
                icon={
                  log.type === "chat_full_scope" ? (
                    <MessageSquare size={10} />
                  ) : (
                    <FileText size={10} />
                  )
                }
              >
                Type: {log.type}
              </LogMetaItem>
              {log.duration && (
                <LogMetaItem icon={<Zap size={10} />}>
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
            <div className="flex flex-wrap gap-4 mb-4">
              {log.tokens && (
                <div className="flex flex-col">
                  <span className="text-[7px] font-mono uppercase tracking-widest opacity-30 mb-0.5">
                    Total Tokens
                  </span>
                  <span className="text-[10px] font-bold tracking-tighter leading-none font-mono">
                    {log.tokens}
                  </span>
                </div>
              )}
              {log.modelConfig && (
                <div className="flex flex-col">
                  <span className="text-[7px] font-mono uppercase tracking-widest opacity-30 mb-0.5">
                    Temperature
                  </span>
                  <span className="text-[10px] font-bold tracking-tighter leading-none font-mono">
                    {log.modelConfig.temperature}
                  </span>
                </div>
              )}
            </div>

            <LogDetailSection<LLMLog> type="llm" id={log.id}>
              {(detail) => (
                <>
                  {detail.systemInstruction && (
                    <TextDetailBlock
                      icon={<Bot size={10} />}
                      label="System Instruction"
                    >
                      {detail.systemInstruction}
                    </TextDetailBlock>
                  )}
                  <TextDetailBlock
                    icon={<MessageSquare size={10} />}
                    label="Prompt / Input"
                  >
                    {detail.prompt}
                  </TextDetailBlock>
                  <TextDetailBlock
                    icon={<FileText size={10} />}
                    label="Response / Output"
                    variant="tall"
                  >
                    {detail.response ||
                      (log.status === "failed"
                        ? "No response generated."
                        : "Empty response.")}
                  </TextDetailBlock>

                  <RequestResponsePanels
                    request={detail.fullRequest}
                    response={detail.fullResponse}
                  />
                </>
              )}
            </LogDetailSection>
            {log.error && <LogErrorBlock error={log.error} />}
          </ExpandableLogDetails>
        </LogCard>
      ))}
    </>
  )
}
