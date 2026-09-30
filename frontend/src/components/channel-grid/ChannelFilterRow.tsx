import { Languages, Layers, Search, Tag, X } from "lucide-react"
import { Fragment } from "react"
import {
  atoms,
  type ChannelFilter,
  type CondType,
  conditionLabel,
  type FilterNames,
  type FilterNode,
  type Joiner,
} from "@/lib/channels/channel-filter"

type ChannelFilterRowProps = {
  filter: ChannelFilter
  search: string
  shownCount: number
  totalCount: number
  names: FilterNames
  onRemove: (id: string) => void
  onClearSearch: () => void
  onClearAll: () => void
}

const ICON: Record<CondType, typeof Tag> = {
  tag: Tag,
  group: Layers,
  language: Languages,
}

// A colour per depth of parentheses, so matching pairs read at a glance.
const DEPTH = [
  "border-sky-500/60 bg-sky-500/5",
  "border-violet-500/60 bg-violet-500/5",
  "border-amber-500/60 bg-amber-500/5",
  "border-emerald-500/60 bg-emerald-500/5",
]

const chipClass =
  "inline-flex h-6 items-center gap-1 rounded-full border bg-app-ink/5 pl-2.5 pr-1 text-[11px] font-semibold"
const removeClass =
  "grid h-4 w-4 place-items-center rounded-full hover:bg-app-ink/15"

const Joined = ({ op }: { op: Joiner }) => (
  <span className="px-0.5 text-[11px] font-semibold text-app-ink/45">{op}</span>
)

const Not = () => (
  <span className="text-[11px] font-semibold text-red-500">not</span>
)

function Block({
  node,
  depth,
  names,
  onRemove,
}: {
  node: FilterNode
  depth: number
  names: FilterNames
  onRemove: (id: string) => void
}) {
  if (node.kind === "atom") {
    const label = conditionLabel(node.cond, names)
    const Icon = ICON[node.cond.type]
    return (
      <span
        data-testid={`channel-filter-chip-${node.cond.value}`}
        data-not={!!node.not}
        className={`${chipClass} ${node.not ? "border-red-500/60" : "border-app-ink/15"}`}
      >
        {node.not && <Not />}
        <Icon size={10} aria-hidden />
        {label}
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={() => onRemove(node.id)}
          className={removeClass}
        >
          <X size={10} />
        </button>
      </span>
    )
  }
  return (
    <span
      data-testid="channel-filter-group"
      data-not={!!node.not}
      className={`inline-flex flex-wrap items-center gap-1 rounded-lg border px-1.5 py-1 ${node.not ? "border-red-500/60" : DEPTH[depth % DEPTH.length]}`}
    >
      {node.not && <Not />}
      <Blocks node={node} depth={depth + 1} names={names} onRemove={onRemove} />
    </span>
  )
}

function Blocks({
  node,
  depth,
  names,
  onRemove,
}: {
  node: FilterNode & { kind: "group" }
  depth: number
  names: FilterNames
  onRemove: (id: string) => void
}) {
  return node.children.map((child, index) => (
    <Fragment key={child.id}>
      {index > 0 && <Joined op={node.op} />}
      <Block node={child} depth={depth} names={names} onRemove={onRemove} />
    </Fragment>
  ))
}

/**
 * The Channel filter row (CTB-01), under row 1 while anything filters the
 * grid: the "N of M" count, the search as a chip, then the whole filter as
 * blocks, nested groups drawn as boxes. The joiners are shown, not yet
 * clickable; CTB-03 makes the row an editor.
 */
export function ChannelFilterRow({
  filter,
  search,
  shownCount,
  totalCount,
  names,
  onRemove,
  onClearSearch,
  onClearAll,
}: ChannelFilterRowProps) {
  const searching = search.trim().length > 0
  const filters = atoms(filter).length + Number(searching)
  if (filters === 0) return null
  return (
    <div
      data-testid="channel-filter-row"
      className="flex flex-wrap items-center gap-1.5 border-t border-app-ink/10 px-3 py-2"
    >
      <span
        data-testid="channel-filter-count"
        className="mr-1 text-[11px] font-semibold tabular-nums text-app-ink/60"
      >
        {shownCount} of {totalCount}
      </span>
      {searching && (
        <span className={`${chipClass} border-app-ink/15`}>
          <Search size={10} aria-hidden />"{search.trim()}"
          <button
            type="button"
            aria-label="Clear the search"
            onClick={onClearSearch}
            className={removeClass}
          >
            <X size={10} />
          </button>
        </span>
      )}
      <span
        data-testid="channel-filter-blocks"
        data-not={!!filter.not}
        className={`inline-flex flex-wrap items-center gap-1 ${filter.not ? "rounded-lg border border-red-500/60 px-1.5 py-1" : ""}`}
      >
        {filter.not && <Not />}
        <Blocks node={filter} depth={0} names={names} onRemove={onRemove} />
      </span>
      {filters >= 2 && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto text-[11px] font-semibold text-app-ink/60 hover:text-app-ink hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
