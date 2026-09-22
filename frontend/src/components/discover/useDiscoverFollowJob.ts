import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
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

  const candidatesByName = useMemo(
    () =>
      new Map(
        candidates.map((row) => [row.name, { reference: row.reference }]),
      ),
    [candidates],
  )

  const resultStatusByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const result of followProgress?.results ?? []) {
      map.set(result.name, result.status)
    }
    return map
  }, [followProgress])

  const executeFollow = async (requested: string[]) => {
    const names = requested.filter((name) => !activeFollowNames.includes(name))
    if (names.length === 0 || isOffline) return

    const payload = buildBulkFollowChannels(names, candidatesByName)
    setActiveFollowNames((prev) => [...prev, ...names])
    setFollowProgress(null)
    try {
      const status = await followDiscoverChannels(payload, {
        onProgress: setFollowProgress,
      })
      if (status) {
        setSelectedForFollow((prev) =>
          pruneSelectionAfterFollow(prev, status.results),
        )
        setFollowProgress(status)
        // `isFollowed` is resolved server-side per read, as `isIgnored` is.
        void queryClient.invalidateQueries({ queryKey: ["discoverReport"] })
      }
    } finally {
      setActiveFollowNames((prev) =>
        prev.filter((name) => !names.includes(name)),
      )
    }
  }

  const startFollow = async (requested: string[]) => {
    const names = requested.filter((name) => !activeFollowNames.includes(name))
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
