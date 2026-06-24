import { useCallback, useMemo, useState } from "react"

import {
  loadAffinityEntries,
  recordAffinityPick,
  saveAffinityEntries,
} from "@/lib/commands/rank-commands"
import type { AffinityEntry } from "@/lib/commands/types"

export function useCommandSearchAffinity() {
  const [entries, setEntries] = useState<AffinityEntry[]>(() =>
    loadAffinityEntries(),
  )

  const recordPick = useCallback((query: string, commandId: string) => {
    setEntries((prev) => {
      const next = recordAffinityPick(query, commandId, prev)
      saveAffinityEntries(next)
      return next
    })
  }, [])

  const affinityEntries = useMemo(() => entries, [entries])

  return { affinityEntries, recordPick }
}
