import { Activity, Database, RefreshCw, RotateCw, Zap } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { useData } from "@/contexts/DataContext"
import { useSettings } from "@/contexts/SettingsContext"
import { JOB_LABELS, useJobToggles } from "@/hooks/useJobToggles"
import { SettingGroupsPanel } from "../SettingGroupsPanel"

export const SyncSection: React.FC = () => {
  const {
    syncConcurrency,
    setSyncConcurrency,
    postRetentionDays,
    globalStartTimeMode,
    setGlobalStartTimeMode,
    globalStartTimeValue,
    setGlobalStartTimeValue,
    getEffectiveGlobalStartTime,
  } = useSettings()
  const { loadChannels } = useData()

  const [bulkReresolveConfirm, setBulkReresolveConfirm] = useState(false)
  const [bulkReresolveLoading, setBulkReresolveLoading] = useState(false)
  const { jobStatus, refreshJobStatus, toggleJob } = useJobToggles()
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null)

  useEffect(() => {
    refreshJobStatus()
    const timer = setInterval(refreshJobStatus, 15_000)
    return () => clearInterval(timer)
  }, [refreshJobStatus])

  const handleTriggerJob = async (jobId: string) => {
    setTriggeringJob(jobId)
    try {
      await api.triggerJob(jobId)
      toast.success(`Triggered ${JOB_LABELS[jobId] || jobId}`)
      await refreshJobStatus()
    } catch (_error) {
      toast.error(`Failed to trigger ${JOB_LABELS[jobId] || jobId}`)
    } finally {
      setTriggeringJob(null)
    }
  }

  const handleToggleJob = async (jobId: string, enabled: boolean) => {
    await toggleJob(jobId, enabled)
  }

  return (
    <div className="space-y-8 lg:col-span-2">
      {/* Automation & Sync */}
      <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <RefreshCw size={18} className="opacity-40" />
          <h4 className="text-[11px] uppercase font-bold tracking-widest">
            Automation & Sync
          </h4>
        </div>

        <div className="space-y-6">
          <SettingGroupsPanel />

          <div className="space-y-4 pt-4 border-t border-app-ink/5">
            <div className="flex items-center gap-2 opacity-60 mb-2">
              <Zap size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Sync Concurrency
              </span>
            </div>
            <p className="text-[10px] opacity-40 italic serif mb-2">
              Number of channels to sync in parallel. Higher is faster but
              riskier.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                value={syncConcurrency}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  setSyncConcurrency(!Number.isNaN(val) && val >= 1 ? val : 1)
                }}
                className="w-20 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
              />
              <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                Parallel channels
              </span>
            </div>
            {syncConcurrency > 50 && (
              <p className="text-[8px] text-amber-600/80 italic serif">
                Values above 50 may trigger rate limits or bans. Use with
                caution.
              </p>
            )}
          </div>

          <div className="space-y-4 pt-4 border-t border-app-ink/5">
            <div className="flex items-center gap-2 opacity-60 mb-2">
              <Database size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Default Channel Start Time
              </span>
            </div>
            <p className="text-[10px] opacity-40 italic serif mb-4">
              When adding a new channel, start scraping from this time.
            </p>

            <div className="flex bg-app-ink/5 p-1 rounded-lg border border-app-ink/10">
              <button
                type="button"
                onClick={() => setGlobalStartTimeMode("retention")}
                className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                  globalStartTimeMode === "retention"
                    ? "bg-app-ink text-app-bg shadow-sm"
                    : "text-app-ink/40 hover:text-app-ink/60"
                }`}
              >
                Match Retention
              </button>
              <button
                type="button"
                onClick={() => {
                  setGlobalStartTimeMode("relative")
                  if (typeof globalStartTimeValue !== "number") {
                    setGlobalStartTimeValue(1)
                  }
                }}
                className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                  globalStartTimeMode === "relative"
                    ? "bg-app-ink text-app-bg shadow-sm"
                    : "text-app-ink/40 hover:text-app-ink/60"
                }`}
              >
                Relative
              </button>
              <button
                type="button"
                onClick={() => setGlobalStartTimeMode("absolute")}
                className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                  globalStartTimeMode === "absolute"
                    ? "bg-app-ink text-app-bg shadow-sm"
                    : "text-app-ink/40 hover:text-app-ink/60"
                }`}
              >
                Absolute
              </button>
            </div>

            <AnimatePresence mode="wait">
              {globalStartTimeMode === "relative" && (
                <motion.div
                  key="relative"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="pt-2"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      value={
                        typeof globalStartTimeValue === "number"
                          ? globalStartTimeValue
                          : 1
                      }
                      onChange={(e) =>
                        setGlobalStartTimeValue(
                          parseInt(e.target.value, 10) || 1,
                        )
                      }
                      className="w-20 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                    />
                    <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                      Days Ago
                    </span>
                  </div>
                </motion.div>
              )}
              {globalStartTimeMode === "absolute" && (
                <motion.div
                  key="absolute"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="pt-2"
                >
                  <input
                    type="datetime-local"
                    value={
                      typeof globalStartTimeValue === "string"
                        ? globalStartTimeValue.slice(0, 16)
                        : new Date().toISOString().slice(0, 16)
                    }
                    onChange={(e) => {
                      if (e.target.value) {
                        const date = new Date(e.target.value)
                        if (!Number.isNaN(date.getTime())) {
                          setGlobalStartTimeValue(date.toISOString())
                        }
                      }
                    }}
                    className="w-full bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-2 p-2 bg-app-ink/5 border border-app-ink/10 rounded flex items-center justify-between">
              <span className="text-[9px] uppercase font-bold opacity-40">
                Effective Start Date
              </span>
              <span className="text-[10px] font-mono font-bold tracking-wider">
                {new Date(getEffectiveGlobalStartTime()).toLocaleString()}
              </span>
            </div>
            {postRetentionDays > 0 && (
              <p className="text-[8px] opacity-40 italic serif text-right">
                Clamped by {postRetentionDays} days retention policy.
              </p>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t border-app-ink/5">
            <div className="flex items-center gap-2 opacity-60">
              <RotateCw size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Bulk Re-sync
              </span>
            </div>
            <p className="text-[10px] opacity-40 italic serif">
              Clear stored posts and re-backfill all channels from the latest
              page backward to the retention window.
            </p>
            {!bulkReresolveConfirm ? (
              <button
                type="button"
                onClick={() => setBulkReresolveConfirm(true)}
                disabled={bulkReresolveLoading}
                className="px-4 py-2 text-[10px] uppercase font-bold tracking-widest border border-app-ink/20 bg-app-ink/5 hover:bg-app-ink/10 transition-all disabled:opacity-40"
              >
                Reset &amp; sync all channels
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={bulkReresolveLoading}
                  onClick={async () => {
                    setBulkReresolveLoading(true)
                    try {
                      const result = await api.bulkResetSync({
                        confirm: true,
                      })
                      await loadChannels()
                      toast.success(
                        `Reset ${result.channelsReset} channel(s); deleted ${result.postsDeleted} post(s).` +
                          (result.errors.length
                            ? ` ${result.errors.length} error(s).`
                            : ""),
                      )
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Bulk re-sync failed",
                      )
                    } finally {
                      setBulkReresolveLoading(false)
                      setBulkReresolveConfirm(false)
                    }
                  }}
                  className="px-4 py-2 text-[10px] uppercase font-bold tracking-widest border border-green-600/40 bg-green-500/10 hover:bg-green-500/20 transition-all disabled:opacity-40"
                >
                  {bulkReresolveLoading ? "Running…" : "Confirm reset & sync"}
                </button>
                <button
                  type="button"
                  disabled={bulkReresolveLoading}
                  onClick={() => setBulkReresolveConfirm(false)}
                  className="px-3 py-2 text-[10px] uppercase font-bold tracking-widest opacity-50 hover:opacity-80"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4 pt-6 border-t border-app-ink/5">
            <div className="flex items-center gap-2 opacity-60 mb-2">
              <Activity size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Background Jobs (Server)
              </span>
            </div>
            <p className="text-[10px] opacity-40 italic serif mb-4">
              APScheduler runs these jobs even when the browser is closed.
            </p>
            <div className="space-y-2">
              {Object.entries(JOB_LABELS).map(([jobId, label]) => {
                const entry = jobStatus[jobId]
                const statusColor =
                  entry?.lastStatus === "ok"
                    ? "text-green-600"
                    : entry?.lastStatus === "error"
                      ? "text-red-500"
                      : entry?.lastStatus === "running"
                        ? "text-amber-600"
                        : "text-app-ink/50"
                return (
                  <div
                    key={jobId}
                    className="flex items-center justify-between gap-3 p-3 border border-app-ink/10 rounded-md bg-app-muted/30"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-tight">
                        {label}
                      </div>
                      <div
                        className={`text-[9px] font-mono uppercase ${statusColor}`}
                      >
                        {entry?.lastStatus || "—"}
                        {entry?.lastError
                          ? ` · ${entry.lastError.slice(0, 60)}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleJob(jobId, !(entry?.enabled ?? true))
                        }
                        className={`w-8 h-4 transition-all relative border border-app-ink/20 rounded-sm ${
                          entry?.enabled !== false
                            ? "bg-green-500 border-green-600"
                            : "bg-app-ink/10"
                        }`}
                        title={
                          entry?.enabled !== false
                            ? "Disable job"
                            : "Enable job"
                        }
                      >
                        <div
                          className={`absolute top-0.5 w-2.5 h-2.5 bg-white transition-all rounded-sm ${
                            entry?.enabled !== false ? "left-4" : "left-0.5"
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTriggerJob(jobId)}
                        disabled={triggeringJob === jobId}
                        className="px-2 py-1 text-[9px] font-mono uppercase border border-app-ink/20 hover:bg-app-ink/5 disabled:opacity-50"
                      >
                        {triggeringJob === jobId ? "…" : "Run"}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
