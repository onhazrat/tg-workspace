import type React from "react"
import type { LogTab } from "@/lib/logs/tabs"
import type {
  EmbeddingLog,
  LLMLogListItem,
  NetworkLog,
  PublishLogListItem,
  SyncLogListItem,
} from "@/types"
import { EmbeddingLogsTab } from "./EmbeddingLogsTab"
import { LlmLogsTab } from "./LlmLogsTab"
import { NetworkLogsTab } from "./NetworkLogsTab"
import { PublishLogsTab } from "./PublishLogsTab"
import { SyncLogsTab } from "./SyncLogsTab"

export interface LogRowsByTab {
  publish: PublishLogListItem[]
  sync: SyncLogListItem[]
  llm: LLMLogListItem[]
  network: NetworkLog[]
  embedding: EmbeddingLog[]
}

interface ActiveLogPanelProps {
  activeTab: LogTab
  logs: LogRowsByTab
  loading: Record<LogTab, boolean>
  visible: Record<LogTab, number>
  expanded: Record<LogTab, string | null>
  onToggleExpand: (tab: LogTab) => (id: string) => void
  onDelete: (tab: LogTab) => (id: string) => void
  onViewSummary: (summaryId: string) => void
}

/** The one log panel the tab bar has selected, fed that tab's slice of the state. */
export const ActiveLogPanel: React.FC<ActiveLogPanelProps> = ({
  activeTab: tab,
  logs,
  loading,
  visible,
  expanded,
  onToggleExpand,
  onDelete,
  onViewSummary,
}) => {
  const shared = {
    isLoading: loading[tab],
    visibleCount: visible[tab],
    expandedId: expanded[tab],
    onToggleExpand: onToggleExpand(tab),
    onDelete: onDelete(tab),
  }
  switch (tab) {
    case "publish":
      return (
        <PublishLogsTab
          logs={logs.publish}
          {...shared}
          onViewSummary={onViewSummary}
        />
      )
    case "sync":
      return <SyncLogsTab logs={logs.sync} {...shared} />
    case "llm":
      return <LlmLogsTab logs={logs.llm} {...shared} />
    case "network":
      return <NetworkLogsTab logs={logs.network} {...shared} />
    case "embedding":
      return <EmbeddingLogsTab logs={logs.embedding} {...shared} />
  }
}
