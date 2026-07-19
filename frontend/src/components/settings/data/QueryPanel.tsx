import { Play } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"

type QueryPanelProps = {
  selectedTable: string
  query: string
  queryResults: unknown[] | null
  queryError: string | null
  isQuerying: boolean
  isServerSource?: boolean
  onQueryChange: (value: string) => void
  onRunQuery: () => void
}

export const QueryPanel: React.FC<QueryPanelProps> = ({
  selectedTable,
  query,
  queryResults,
  queryError,
  isQuerying,
  isServerSource = false,
  onQueryChange,
  onRunQuery,
}) => {
  if (!selectedTable) return null

  return (
    <div className="border border-app-ink/10 p-4 bg-app-muted/30">
      <h5 className="text-[10px] uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
        Query <span className="text-blue-500">{selectedTable}</span>
      </h5>
      {isServerSource && (
        // Queries are JS expressions run over IndexedDB records, so they
        // cannot reach Postgres. Say so rather than quietly returning local
        // rows while the sizes above describe the backend.
        <p className="text-[9px] uppercase tracking-widest font-bold text-amber-600 dark:text-amber-500 mb-3">
          Queries always run against local browser data, not the backend DB
        </p>
      )}
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="e.g. channelName === 'mychannel' (leave empty for all)"
          className="flex-1 bg-app-card border border-app-ink/20 px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-app-ink/50"
          onKeyDown={(e) => e.key === "Enter" && onRunQuery()}
        />
        <TgButton
          type="button"
          variant="primary"
          size="md"
          onClick={onRunQuery}
          loading={isQuerying}
          loadingLabel="Run"
        >
          <Play size={14} />
          Run
        </TgButton>
      </div>
      <p className="text-[9px] opacity-50 italic mb-4">
        Uses simple JS evaluation. Example:{" "}
        <code className="bg-app-ink/10 px-1 py-0.5 rounded">id &gt; 100</code>{" "}
        or{" "}
        <code className="bg-app-ink/10 px-1 py-0.5 rounded">
          text.includes('crypto')
        </code>
      </p>

      {queryError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-[11px] font-mono mb-4">
          {queryError}
        </div>
      )}

      {queryResults && (
        <div className="border border-app-ink/10 bg-app-card overflow-hidden">
          <div className="p-2 bg-app-ink/5 border-b border-app-ink/10 flex justify-between items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest">
              Results ({queryResults.length}
              {queryResults.length === 100 ? "+" : ""})
            </span>
          </div>
          <div className="max-h-96 overflow-auto p-4 text-[11px] font-mono whitespace-pre-wrap">
            {queryResults.length > 0 ? (
              JSON.stringify(queryResults, null, 2)
            ) : (
              <span className="opacity-50 italic">No results found.</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
