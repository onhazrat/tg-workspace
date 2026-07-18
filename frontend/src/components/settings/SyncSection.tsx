import { Activity, Database, RefreshCw, RotateCw, Zap } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { TgButton } from "@/components/ui/tg-button"
import { TgHelpText, TgInput } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
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
      <TgSettingsSection icon={RefreshCw} title="Automation & Sync">
        <div className="space-y-6">
          <SettingGroupsPanel />

          <div className="space-y-4 pt-4 border-t border-app-ink/5">
            <div className="flex items-center gap-2 opacity-60 mb-2">
              <Zap size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Sync Concurrency
              </span>
            </div>
            <TgHelpText className="mb-2">
              Number of channels to sync in parallel. Higher is faster but
              riskier.
            </TgHelpText>
            <div className="flex items-center gap-3">
              <TgInput
                type="number"
                min="1"
                value={syncConcurrency}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  setSyncConcurrency(!Number.isNaN(val) && val >= 1 ? val : 1)
                }}
                className="w-20 p-2 normal-case tracking-normal rounded"
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
            <TgHelpText className="mb-4">
              When adding a new channel, start scraping from this time.
            </TgHelpText>

            <TgSegmentedControl
              size="sm"
              className="w-full"
              optionClassName="flex-1"
              aria-label="Default channel start time"
              value={globalStartTimeMode}
              onChange={(mode) => {
                setGlobalStartTimeMode(mode)
                if (
                  mode === "relative" &&
                  typeof globalStartTimeValue !== "number"
                ) {
                  setGlobalStartTimeValue(1)
                }
              }}
              options={[
                { value: "retention", label: "Match Retention" },
                { value: "relative", label: "Relative" },
                { value: "absolute", label: "Absolute" },
              ]}
            />

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
                    <TgInput
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
                      className="w-20 p-2 normal-case tracking-normal rounded"
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
                  <TgInput
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
                    className="p-2 normal-case tracking-normal rounded"
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
            <TgHelpText>
              Clear stored posts and re-backfill all channels from the latest
              page backward to the retention window.
            </TgHelpText>
            {!bulkReresolveConfirm ? (
              <TgButton
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setBulkReresolveConfirm(true)}
                disabled={bulkReresolveLoading}
              >
                Reset &amp; sync all channels
              </TgButton>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <TgButton
                  type="button"
                  variant="successSoft"
                  size="md"
                  loading={bulkReresolveLoading}
                  loadingLabel="Running…"
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
                >
                  Confirm reset & sync
                </TgButton>
                <TgButton
                  type="button"
                  variant="ghost"
                  size="md"
                  disabled={bulkReresolveLoading}
                  onClick={() => setBulkReresolveConfirm(false)}
                >
                  Cancel
                </TgButton>
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
            <TgHelpText className="mb-4">
              APScheduler runs these jobs even when the browser is closed.
            </TgHelpText>
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
                      <TgButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleTriggerJob(jobId)}
                        loading={triggeringJob === jobId}
                        loadingLabel="…"
                      >
                        Run
                      </TgButton>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </TgSettingsSection>
    </div>
  )
}
