import { AlertTriangle } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"

import type { LogType } from "@/api/data"
import { useLogDetailQuery } from "@/hooks/useLogs"

/** Animated container for a log row's expandable detail section. */
export const ExpandableLogDetails: React.FC<{
  expanded: boolean
  children: React.ReactNode
}> = ({ expanded, children }) => (
  <AnimatePresence>
    {expanded && (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="overflow-hidden"
      >
        <div className="mt-4 space-y-4 pt-4 border-t border-app-ink/5">
          {children}
        </div>
      </motion.div>
    )}
  </AnimatePresence>
)

/** Pretty-printed JSON payload with a small label. */
export const JsonDetailPanel: React.FC<{ label: string; value: unknown }> = ({
  label,
  value,
}) => (
  <div className="space-y-1.5">
    <label className="text-[8px] uppercase font-bold opacity-40">{label}</label>
    <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
      {JSON.stringify(value, null, 2)}
    </div>
  </div>
)

/** Side-by-side full request/response JSON panels (each only if present). */
export const RequestResponsePanels: React.FC<{
  request?: unknown
  response?: unknown
}> = ({ request, response }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {request ? (
      <JsonDetailPanel label="Full Request (JSON)" value={request} />
    ) : null}
    {response ? (
      <JsonDetailPanel label="Full Response (JSON)" value={response} />
    ) : null}
  </div>
)

interface TextDetailBlockProps {
  icon: React.ReactNode
  label: string
  /** "default" = dimmed, max-h-40; "tall" = full opacity, max-h-60. */
  variant?: "default" | "tall"
  children: React.ReactNode
}

/** Labeled free-text detail box (prompts, responses, sent text, ...). */
export const TextDetailBlock: React.FC<TextDetailBlockProps> = ({
  icon,
  label,
  variant = "default",
  children,
}) => (
  <div className="space-y-1.5">
    <label className="text-[8px] uppercase font-bold opacity-40 flex items-center gap-1.5">
      {icon}
      {label}
    </label>
    <div
      className={
        variant === "tall"
          ? "p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[10px] whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed"
          : "p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed opacity-80"
      }
    >
      {children}
    </div>
  </div>
)

/** Red error callout used by every log tab. */
export const LogErrorBlock: React.FC<{
  error: string
  topMargin?: boolean
}> = ({ error, topMargin = false }) => (
  <div
    className={`${topMargin ? "mt-3 " : ""}p-3 bg-red-500/5 border border-red-500/10 rounded flex items-start gap-3`}
  >
    <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
    <div className="space-y-1">
      <p className="text-[9px] font-bold uppercase text-red-500 opacity-70">
        Error Message:
      </p>
      <p className="text-[10px] font-mono text-red-600 leading-relaxed">
        {error}
      </p>
    </div>
  </div>
)

/**
 * Fetches the bodies for one expanded log row and hands them to `children`.
 *
 * The list projection stopped carrying them: `GET /data/logs/sync` was
 * **56.28 MB for a page of 500 rows, 99.7% of it request/response bodies** that
 * only an expanded row ever renders — and only one row is expanded at a time.
 *
 * Rendered *inside* `ExpandableLogDetails`, so it mounts on expand and the
 * request happens then. Reopening the same row is a cache hit: the query key is
 * per row and `staleTime` is infinite, because a log row never changes once
 * written.
 */
export function LogDetailSection<T>({
  type,
  id,
  children,
}: {
  type: LogType
  id: string
  children: (detail: T) => React.ReactNode
}) {
  const { data, isPending, isError, refetch } = useLogDetailQuery<T>(type, id)

  if (isPending) {
    return (
      <p className="text-[9px] font-mono uppercase tracking-widest opacity-40">
        Loading details…
      </p>
    )
  }

  if (isError || !data) {
    return (
      <button
        type="button"
        onClick={() => refetch()}
        className="text-[9px] font-mono uppercase tracking-widest text-red-500 opacity-70 hover:opacity-100"
      >
        Could not load details — retry
      </button>
    )
  }

  return <>{children(data)}</>
}
