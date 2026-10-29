/**
 * The Channels tab's Tags by Tag use (TGU-02, ADR-042): one order for its
 * Tags dropdown, the bulk bar's Tag fields and the filter row's Tag options,
 * the dropdown's rename and delete, and recording each use on this tab.
 */
import { useCallback, useMemo } from "react"
import { useTagManage } from "@/hooks/useTags"
import { recordTagUse, useTagUses } from "@/hooks/useTagUses"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import { byTagUse } from "@/lib/tags/tag-use"
import type { Channel } from "@/types"

export function useChannelTagUse(channels: Channel[]) {
  const score = useTagUses("channels")
  const counts = useMemo(() => {
    const byTag = new Map<string, number>()
    for (const channel of channels)
      for (const tag of getTagNames(channel.tags))
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
    return byTag
  }, [channels])
  const manage = useTagManage()
  /** `items` by this tab's Tag use, then `count` (by default each Tag's
   * Channels on the tab), then name. Stable until the uses or Channels change. */
  const order = useCallback(
    <T>(
      items: readonly T[],
      name: (item: T) => string,
      count: (item: T) => number = (item) => counts.get(name(item)) ?? 0,
    ) => byTagUse(items, score, name, count),
    [score, counts],
  )
  return { manage, order, record, afterTagging }
}

const record = (...names: string[]) => recordTagUse("channels", ...names)

/** Bulk tagging or untagging by hand with `typed`, then its Tag use. */
function afterTagging(run: () => Promise<void>, typed: string) {
  const name = typed.trim()
  void run().then(() => name && record(name))
}
