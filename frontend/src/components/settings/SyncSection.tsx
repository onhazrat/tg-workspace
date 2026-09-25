import { Activity, RefreshCw, RotateCw } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { TgButton } from "@/components/ui/tg-button"
import { TgHelpText } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { useData } from "@/contexts/DataContext"
import { useSettings } from "@/contexts/SettingsContext"
import { JOB_LABELS, useJobToggles } from "@/hooks/useJobToggles"
import { getCatalogEntry } from "@/lib/settings/catalog"
import { CatalogSettingRow } from "./CommonlyUsedSection"
import { JobRow, StartTimeSetting } from "./SyncSectionParts"

const SYNC_CATALOG_IDS = [
  "regularSyncIntervalMinutes",
  "dynamicSyncEnabledDefault",
  "dynamicSyncExpectedPostsDefault",
  "syncFailureBackoffMinutes",
] as const

export const SyncSection: React.FC<{
  highlightId?: string | null
}> = ({ highlightId = null }) => {
  const {
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
          <div className="space-y-1">
            {SYNC_CATALOG_IDS.map((id) => {
              const entry = getCatalogEntry(id)
              return entry ? (
                <CatalogSettingRow
                  key={id}
                  entry={entry}
                  highlighted={highlightId === id}
                />
              ) : null
            })}
          </div>

          <StartTimeSetting
            highlightId={highlightId}
            mode={globalStartTimeMode}
            value={globalStartTimeValue}
            effectiveStartTime={getEffectiveGlobalStartTime()}
            postRetentionDays={postRetentionDays}
            onModeChange={setGlobalStartTimeMode}
            onValueChange={setGlobalStartTimeValue}
          />

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
              {Object.entries(JOB_LABELS).map(([jobId, label]) => (
                <JobRow
                  key={jobId}
                  label={label}
                  entry={jobStatus[jobId]}
                  triggering={triggeringJob === jobId}
                  onToggle={(enabled) => handleToggleJob(jobId, enabled)}
                  onRun={() => handleTriggerJob(jobId)}
                />
              ))}
            </div>
          </div>
        </div>
      </TgSettingsSection>
    </div>
  )
}
