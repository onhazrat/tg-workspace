import { Braces, Check, Copy, Loader2, RefreshCw } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "@/api"
import type { RuntimeConfig } from "@/api/jobs"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"

export const RuntimeConfigView: React.FC = () => {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedText, copy] = useCopyToClipboard()

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getRuntimeConfig()
      setConfig(data)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load runtime config",
      )
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const formattedJson = useMemo(
    () => (config ? JSON.stringify(config, null, 2) : ""),
    [config],
  )

  const isCopied = copiedText === formattedJson && formattedJson.length > 0

  return (
    <motion.div
      key="runtime-config"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-5xl pb-20"
    >
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
          <div className="text-left">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm uppercase font-bold tracking-widest">
                Runtime Config
              </h3>
              <span className="text-[10px] font-mono opacity-40">
                [EFFECTIVE_VALUES]
              </span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              Effective sync, scraper, network, job, and retention settings
              resolved at runtime.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy(formattedJson)}
              disabled={!config || loading}
              className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase font-bold tracking-widest border border-app-ink/10 rounded-sm hover:bg-app-ink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isCopied ? <Check size={12} /> : <Copy size={12} />}
              {isCopied ? "Copied" : "Copy JSON"}
            </button>
            <button
              type="button"
              onClick={() => void loadConfig()}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase font-bold tracking-widest border border-app-ink/10 rounded-sm hover:bg-app-ink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
        <div className="h-px bg-app-ink/10 w-full" />
      </div>

      {loading && !config && (
        <div className="flex items-center gap-2 text-[11px] font-mono opacity-60">
          <Loader2 size={14} className="animate-spin" />
          Loading runtime config...
        </div>
      )}

      {error && (
        <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-4 py-3 text-[11px] font-mono text-red-400">
          {error}
        </div>
      )}

      {config && (
        <div className="rounded-sm border border-app-ink/10 bg-app-ink/5 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-app-ink/10 bg-app-ink/5">
            <Braces size={12} className="opacity-50" />
            <span className="text-[10px] font-mono uppercase tracking-widest opacity-50">
              GET /api/v1/jobs/runtime-config
            </span>
          </div>
          <pre className="p-4 overflow-x-auto text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words">
            {formattedJson}
          </pre>
        </div>
      )}
    </motion.div>
  )
}
