import { useCallback, useMemo, useState } from "react"

import type { CommandDef } from "@/lib/commands/types"
import { scopedStorage } from "@/lib/storage/scoped"

const RECENTS_STORAGE_KEY = "commandPaletteRecents"
const RECENTS_MAX_ENTRIES = 500

export interface RecentCommandEntry {
  commandId: string
  lastUsedAt: number
}

function loadRecentEntries(): RecentCommandEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = scopedStorage.getItem(RECENTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentCommandEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveRecentEntries(entries: RecentCommandEntry[]): void {
  if (typeof window === "undefined") return
  scopedStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(entries))
}

export function useRecentCommands(commands: CommandDef[]) {
  const [entries, setEntries] = useState<RecentCommandEntry[]>(() =>
    loadRecentEntries(),
  )

  const commandMap = useMemo(
    () => new Map(commands.map((command) => [command.id, command])),
    [commands],
  )

  const recentCommands = useMemo(() => {
    return entries
      .map((entry) => commandMap.get(entry.commandId))
      .filter((command): command is CommandDef => command !== undefined)
  }, [commandMap, entries])

  const recordRecent = useCallback((commandId: string) => {
    setEntries((prev) => {
      const now = Date.now()
      const without = prev.filter((entry) => entry.commandId !== commandId)
      const next = [{ commandId, lastUsedAt: now }, ...without].slice(
        0,
        RECENTS_MAX_ENTRIES,
      )
      saveRecentEntries(next)
      return next
    })
  }, [])

  return { recentCommands, recordRecent }
}
