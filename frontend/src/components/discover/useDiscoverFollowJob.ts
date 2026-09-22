import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef, useState } from "react"
import type { FollowJobStatus } from "@/api"
import type { DiscoveryCandidate } from "@/lib/posts/discover-candidates"
import {
  buildBulkFollowChannels,
  needsBulkFollowConfirm,
  pruneSelectionAfterFollow,
} from "@/lib/posts/discover-selection"

interface UseDiscoverFollowJobOptions {
  candidates: DiscoveryCandidate[]
  isOffline: boolean
  followDiscoverChannels: (
    payload: ReturnType<typeof buildBulkFollowChannels>,
    options: { onProgress: (status: FollowJobStatus) => void },
  ) => Promise<FollowJobStatus | null | undefined>
}

/** Owns the Discover bulk-follow job lifecycle: confirmation, progress, selection pruning. */
export function useDiscoverFollowJob({
  candidates,
  isOffline,
  followDiscoverChannels,
}: UseDiscoverFollowJobOptions) {
  const queryClient = useQueryClient()
  const [selectedForFollow, setSelectedForFollow] = useState<Set<string>>(
    () => new Set(),
  )
  const [followProgress, setFollowProgress] = useState<FollowJobStatus | null>(
    null,
  )
  const [pendingFollowNames, setPendingFollowNames] = useState<string[] | null>(
    null,
  )
  // Every name in any running follow job. Rows lock one by one, so following
  // one Candidate never blocks following another.
  const [activeFollowNames, setActiveFollowNames] = useState<string[]>([])
  const isFollowJobRunning = activeFollowNames.length > 0
  // The same names, read synchronously: two clicks in one render would both
  // pass a filter over the state and start two jobs for one Channel.
  const inFlightRef = useRef(new Set<string>())
  // Only the newest job reports progress, so overlapping jobs never
  // interleave their counters.
  const latestJobRef = useRef(0)
  const [resultStatusByName, setResultStatusByName] = useState<
    Map<string, string>
  >(() => new Map())

  const candidatesByName = useMemo(
    () =>
      new Map(
        candidates.map((row) => [row.name, { reference: row.reference }]),
      ),
    [candidates],
  )

  const executeFollow = async (requested: string[]) => {
    const names = requested.filter((name) => !inFlightRef.current.has(name))
    if (names.length === 0 || isOffline) return

    const payload = buildBulkFollowChannels(names, candidatesByName)
    for (const name of names) inFlightRef.current.add(name)
    setActiveFollowNames((prev) => [...prev, ...names])
    const job = ++latestJobRef.current
    setFollowProgress(null)
    const onProgress = (status: FollowJobStatus) => {
      // Statuses from every job, so a newer job does not erase an older one's.
      setResultStatusByName((prev) => {
        const next = new Map(prev)
        for (const result of status.results)
          next.set(result.name, result.status)
        return next
      })
      if (job === latestJobRef.current) setFollowProgress(status)
    }
    try {
      const status = await followDiscoverChannels(payload, { onProgress })
      if (status) {
        setSelectedForFollow((prev) =>
          pruneSelectionAfterFollow(prev, status.results),
        )
        onProgress(status)
        // `isFollowed` is resolved server-side per read, as `isIgnored` is.
        // Awaited so the row never shows an enabled Follow button between the
        // unlock below and the refetch.
        await queryClient.invalidateQueries({ queryKey: ["discoverReport"] })
      }
    } finally {
      for (const name of names) inFlightRef.current.delete(name)
      setActiveFollowNames((prev) =>
        prev.filter((name) => !names.includes(name)),
      )
    }
  }

  const startFollow = async (requested: string[]) => {
    const names = requested.filter((name) => !inFlightRef.current.has(name))
    if (names.length === 0 || isOffline) return
    if (needsBulkFollowConfirm(names.length)) {
      setPendingFollowNames(names)
      return
    }
    await executeFollow(names)
  }

  const followOne = async (name: string) => {
    const candidate = candidates.find((row) => row.name === name)
    if (!candidate || candidate.isFollowed) return
    await startFollow([name])
  }

  const followSelected = async () => {
    const names = [...selectedForFollow].filter((name) => {
      const row = candidates.find((candidate) => candidate.name === name)
      return row && !row.isFollowed
    })
    await startFollow(names)
  }

  return {
    selectedForFollow,
    setSelectedForFollow,
    isFollowJobRunning,
    followProgress,
    pendingFollowNames,
    setPendingFollowNames,
    activeFollowNames,
    resultStatusByName,
    executeFollow,
    followOne,
    followSelected,
  }
}
