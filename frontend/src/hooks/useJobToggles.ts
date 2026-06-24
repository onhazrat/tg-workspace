import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import type { JobStatusEntry } from "@/api/jobs"

export const JOB_LABELS: Record<string, string> = {
  auto_sync: "Auto Sync",
  embeddings: "Embeddings",
  auto_summary: "Auto Summary",
  retention: "Retention",
  translation_batch: "Translation Batch",
}

export const SERVER_JOB_IDS = [
  "auto_sync",
  "embeddings",
  "auto_summary",
  "retention",
  "translation_batch",
] as const

export type ServerJobId = (typeof SERVER_JOB_IDS)[number]

export function useJobToggles() {
  const [jobStatus, setJobStatus] = useState<Record<string, JobStatusEntry>>({})

  const refreshJobStatus = useCallback(async () => {
    try {
      const status = await api.jobsStatus()
      setJobStatus(status)
    } catch (error) {
      console.error("[useJobToggles] Failed to fetch job status:", error)
    }
  }, [])

  useEffect(() => {
    refreshJobStatus()
  }, [refreshJobStatus])

  const toggleJob = useCallback(
    async (jobId: string, enabled: boolean) => {
      try {
        await api.updateJob(jobId, enabled)
        await refreshJobStatus()
      } catch (_error) {
        toast.error(`Failed to update ${JOB_LABELS[jobId] || jobId}`)
      }
    },
    [refreshJobStatus],
  )

  const isJobEnabled = useCallback(
    (jobId: string) => jobStatus[jobId]?.enabled ?? false,
    [jobStatus],
  )

  return {
    jobStatus,
    refreshJobStatus,
    toggleJob,
    isJobEnabled,
    JOB_LABELS,
  }
}
