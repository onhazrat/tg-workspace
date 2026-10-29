/**
 * The Tags dropdown the Directory and the Requests tab share (TGU-03), the
 * Channels tab's `FacetMenu` rows: select, name, rename, delete, count,
 * filter. Each Tag's channels in the tab's scope and how many are selected
 * come from one read as it opens; a Tag with none of them is not listed. The
 * rows follow the tab's Tag use order and hold it while open. Selecting a Tag
 * fetches that one Tag's handles and hands them to the tab.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Tag } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { dataReadTagOrder, type TagOrderResponse } from "@/client"
import { queryKeys } from "@/hooks/queryKeys"
import { fetchTagHandles, useTagManage, useTags } from "@/hooks/useTags"
import { recordTagUse, useTagUses } from "@/hooks/useTagUses"
import { errorText } from "@/lib/artifacts/artifact-run"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import { byTagUse, type TagTab } from "@/lib/tags/tag-use"
import { FacetMenu, type FacetMenuRow } from "./FacetMenu"

type TagsDropdownProps = {
  tab: Exclude<TagTab, "channels">
  testId: string
  /** The line over the rows: what selecting a Tag does on this tab. */
  tickHint: string
  /** The handles the tab lists; null for every Channel, as the Directory's. */
  scope: string[] | null
  /** The handles in the tab's selection. */
  selected: string[]
  /** Add a Tag's handles (lowercased) to the tab's selection, or take them out. */
  onSelect: (handles: string[], on: boolean) => void
  /** The Tags the tab's filter is funnelled by; two mean either one. */
  funnelled: string[]
  onFunnel: (name: string, on: boolean) => void
  onClearFunnels: () => void
}

const tickOf = (selected: number, total: number): FacetMenuRow["tick"] =>
  total > 0 && selected === total ? "true" : selected > 0 ? "mixed" : "false"

export function TagsDropdown(p: TagsDropdownProps) {
  const [open, setOpen] = useState(false)
  const tags = useTags()
  const manage = useTagManage()
  const score = useTagUses(p.tab)
  const counts = useQuery({
    queryKey: [...queryKeys.tagOrder(p.tab), p.scope, p.selected],
    queryFn: () =>
      dataReadTagOrder({
        body: { tab: p.tab, scope: p.scope, selected: p.selected },
      }),
    enabled: open,
    placeholderData: keepPreviousData,
    select: (rows) =>
      new Map<string, TagOrderResponse>(
        rows.map((row) => [row.name.toLowerCase(), row]),
      ),
  })
  const countOf = (name: string) => counts.data?.get(name.toLowerCase())
  // Until the read is in, a Tag's every channel stands in, busy.
  const total = (t: { name: string; channels: number }) =>
    countOf(t.name)?.channels ?? t.channels
  const listed = byTagUse(
    tags.tags.filter((t) => !isVirtualGroupTag(t.name) && total(t) > 0),
    score,
    (t) => t.name,
    total,
  )
  const rows: FacetMenuRow[] = listed.map((t) => {
    const selected = countOf(t.name)?.selected ?? 0
    return {
      id: t.name,
      label: t.name,
      selected,
      total: total(t),
      tick: tickOf(selected, total(t)),
      busy: countOf(t.name) === undefined,
    }
  })
  const select = async (row: FacetMenuRow) => {
    recordTagUse(p.tab, row.id)
    try {
      const handles = await fetchTagHandles(row.id)
      p.onSelect([...handles], row.tick !== "true")
    } catch (error) {
      toast.error(errorText(error, "The Tag's channels did not load."))
    }
  }
  return (
    <FacetMenu
      icon={<Tag size={12} />}
      label="Tags"
      noun="tag"
      testId={p.testId}
      tickHint={p.tickHint}
      freezeOrder
      onOpenChange={setOpen}
      rows={rows}
      onToggleSelect={(row) => void select(row)}
      funnelled={p.funnelled}
      labelOf={(id) => id}
      onFunnel={p.onFunnel}
      onClearFunnels={p.onClearFunnels}
      manage={manage}
    />
  )
}
