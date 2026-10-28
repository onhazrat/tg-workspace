// PROTOTYPE (channel-tags-usage): the Tags dropdown as the Directory and the
// Requests tab show it, the Channels tab's own `FacetMenu` rows: a tick,
// `selected/total`, rename and delete, the funnel. Never merge.
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Tag } from "lucide-react"
import { useState } from "react"
import { headers } from "@/api/base"
import { dataListTagChannels } from "@/client"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import { queryKeys } from "@/hooks/queryKeys"
import { useTags } from "@/hooks/useTags"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import { queryClient } from "@/lib/queryClient"
import {
  bumpTagUse,
  byUsage,
  isB,
  mergeText,
  renameTagUse,
  type TagTab,
  usageHint,
  useTagUsage,
} from "./store"
import { useTagHandles } from "./tag-handles"

type Counts = Record<string, { total: number; selected: number }>

/** One Tag's handles, lowercased, through the same cache `useTagHandles` fills. */
const fetchHandles = (name: string) =>
  queryClient.fetchQuery({
    queryKey: [...queryKeys.tags, "handles", name],
    queryFn: async () => {
      const { handles } = await dataListTagChannels({ query: { name } })
      return new Set(handles.map((h) => h.toLowerCase()))
    },
  })

export function TagFacet({
  tab,
  variant,
  testId,
  align,
  tickHint,
  scope,
  members,
  selected,
  onSelect,
  funnelled,
  onFunnel,
  onClearFunnels,
}: {
  tab: TagTab
  variant: string
  testId: string
  align?: "start" | "end"
  tickHint?: string
  /** B: the handles this tab lists, for the counts route; null for every channel. */
  scope: string[] | null
  /** The ids this tab's selection holds for a Tag's handles (lowercased). */
  members: (handles: ReadonlySet<string>) => string[]
  selected: ReadonlySet<string>
  onSelect: (ids: string[], on: boolean) => void
  funnelled: string[]
  onFunnel: (name: string, on: boolean) => void
  onClearFunnels: () => void
}) {
  const server = isB(variant)
  const tags = useTags()
  const usage = useTagUsage(variant, tab)
  const [opened, setOpened] = useState(false)
  // A: every Tag's handles once the dropdown first opens. B: only the
  // `group:` Tags', which are a Setting group's and so not in the counts route.
  const handlesOf = useTagHandles(
    opened
      ? tags.tags
          .map((t) => t.name)
          .filter((name) => !server || isVirtualGroupTag(name))
      : [],
  )
  // B: one query for every Tag's counts against this tab's channels.
  const selectedList = [...selected].map((h) => h.toLowerCase()).sort()
  const counts = useQuery({
    queryKey: ["proto", "tagCounts", tab, scope, selectedList],
    queryFn: async () =>
      (await (
        await fetch("/proto/tags/counts", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ scope, selected: selectedList }),
        })
      ).json()) as Counts,
    enabled: server && opened,
    placeholderData: keepPreviousData,
  })
  const countOf = (name: string) => {
    if (server && !isVirtualGroupTag(name))
      return counts.data?.[name.toLowerCase()]
    const handles = handlesOf(name)
    if (!handles) return undefined
    const ids = members(handles)
    return {
      total: ids.length,
      selected: ids.filter((id) => selected.has(id)).length,
    }
  }
  // As on the Channels tab: a Tag with none of this tab's channels is not
  // listed once its counts are in, and ties go to the most of them.
  const shownCount = (t: { name: string; channels: number }) =>
    countOf(t.name)?.total ?? t.channels
  const ordered = byUsage(
    tags.tags.filter((t) => shownCount(t) > 0),
    usage,
    (t) => t.name,
    shownCount,
  )
  return (
    <FacetMenu
      icon={<Tag size={12} />}
      label="Tags"
      noun="tag"
      testId={testId}
      align={align}
      tickHint={tickHint}
      freezeOrder={server}
      onOpenChange={(open) => open && setOpened(true)}
      rows={ordered.map((t) => {
        const c = countOf(t.name)
        const sel = c?.selected ?? 0
        const total = shownCount(t)
        return {
          id: t.name,
          label: t.name,
          hint: usageHint(usage(t.name)),
          selected: sel,
          total,
          tick:
            total > 0 && sel === total
              ? ("true" as const)
              : sel > 0
                ? ("mixed" as const)
                : ("false" as const),
          busy: c === undefined,
        }
      })}
      onToggleSelect={(row) => {
        bumpTagUse(tab, row.id)
        void fetchHandles(row.id).then((handles) =>
          onSelect(members(handles), row.tick !== "true"),
        )
      }}
      funnelled={funnelled}
      labelOf={(id) => id}
      onFunnel={(id, on) => {
        if (on) bumpTagUse(tab, id)
        onFunnel(id, on)
      }}
      onClearFunnels={onClearFunnels}
      manage={{
        can: (row) => !isVirtualGroupTag(row.id),
        onRename: (id, to) => {
          renameTagUse(tab, id, to)
          void tags.rename(id, to)
        },
        onDelete: (id) => void tags.remove(id),
        deleteText: (row) => {
          const n = tags.tags.find((t) => t.name === row.id)?.channels ?? 0
          return `"${row.label}" is on ${n} channel${n === 1 ? "" : "s"}, followed or not; deleting it takes it off every one.`
        },
        mergeText: server
          ? (id, to) => mergeText(tags.tags, id, to)
          : undefined,
      }}
    />
  )
}
