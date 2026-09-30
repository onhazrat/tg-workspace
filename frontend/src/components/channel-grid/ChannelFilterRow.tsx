import { Parentheses, Plus, Search, Ungroup, X } from "lucide-react"
import type React from "react"
import { Fragment, useState } from "react"
import {
  type AtomNode,
  append,
  atoms,
  type ChannelFilter,
  conditionLabel,
  type FilterNames,
  flip,
  type GroupNode,
  groupWith,
  type Joiner,
  moveNode,
  removeNode,
  replaceCond,
  setOp,
  toggleNot,
  unwrap,
  wrap,
} from "@/lib/channels/channel-filter"
import type { MetricData } from "@/lib/channels/channel-metrics"
import {
  ChannelConditionPicker,
  CONDITION_ICON,
  type ConditionOptions,
} from "./ChannelConditionPicker"

/** What every block needs, passed down the tree as one. */
type Editor = {
  filter: ChannelFilter
  onChange: (next: ChannelFilter) => void
  names: FilterNames
  metrics: MetricData
  options: ConditionOptions
  /** The block being dragged, and the chip, box or gap under it. */
  dragId: string | null
  overId: string | null
  setDragId: (id: string | null) => void
  setOverId: (id: string | null) => void
}

type ChannelFilterRowProps = Pick<
  Editor,
  "filter" | "onChange" | "names" | "metrics" | "options"
> & {
  search: string
  shownCount: number
  totalCount: number
  onClearSearch: () => void
  onClearAll: () => void
}

// A colour per depth of parentheses, so matching pairs read at a glance.
const DEPTH = [
  "border-sky-500/60 bg-sky-500/5",
  "border-violet-500/60 bg-violet-500/5",
  "border-amber-500/60 bg-amber-500/5",
  "border-emerald-500/60 bg-emerald-500/5",
]
const NEGATED = "border-red-500/60 bg-red-500/5"
const DROP = "ring-2 ring-app-ink/50"

const chipClass =
  "inline-flex h-6 items-center gap-1 rounded-full border bg-app-ink/5 pl-1 pr-1 text-[11px] font-semibold"
const iconButtonClass =
  "grid h-4 w-4 place-items-center rounded-full text-app-ink/50 hover:bg-app-ink/15 hover:text-app-ink"

/** NOT on one block: faint when off, red when on. */
function NotToggle({
  on,
  label,
  onClick,
}: {
  on?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!!on}
      onClick={onClick}
      className={`rounded px-1 text-[10px] font-bold uppercase ${
        on
          ? "bg-red-500 text-white"
          : "text-app-ink/30 hover:bg-app-ink/10 hover:text-app-ink"
      }`}
    >
      not
    </button>
  )
}

/**
 * What makes a chip or a box a drag source and a drop target. A drop groups
 * the dragged block with this one, and anything the model refuses (a block
 * onto itself, or onto its own parentheses) is never offered.
 */
function dragProps(ed: Editor, id: string) {
  const dropped = () =>
    ed.dragId ? groupWith(ed.filter, ed.dragId, id) : ed.filter
  return {
    draggable: true,
    "data-drop": ed.overId === id,
    onDragStart: (e: React.DragEvent) => {
      // A chip sits inside its box, which drags too: without this the drag
      // start bubbles and the outermost box moves instead.
      e.stopPropagation()
      e.dataTransfer.setData("text/plain", id)
      e.dataTransfer.effectAllowed = "move"
      ed.setDragId(id)
    },
    onDragEnd: () => {
      ed.setDragId(null)
      ed.setOverId(null)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!ed.dragId) return
      e.stopPropagation()
      if (dropped() === ed.filter) return
      e.preventDefault()
      ed.setOverId(id)
    },
    onDragLeave: () => ed.setOverId(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const next = dropped()
      ed.setDragId(null)
      ed.setOverId(null)
      if (next !== ed.filter) ed.onChange(next)
    },
  }
}

/** Where a dragged block can move to; shown only while one is dragged. */
function Gap({
  ed,
  parentId,
  index,
}: {
  ed: Editor
  parentId: string
  index: number
}) {
  if (!ed.dragId) return null
  const next = moveNode(ed.filter, ed.dragId, parentId, index)
  if (next === ed.filter) return null
  const id = `gap:${parentId}:${index}`
  const over = ed.overId === id
  return (
    <span
      data-testid="channel-filter-gap"
      data-drop={over}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        ed.setOverId(id)
      }}
      onDragLeave={() => ed.setOverId(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        ed.setDragId(null)
        ed.setOverId(null)
        ed.onChange(next)
      }}
      className={`inline-block h-6 rounded transition-all ${over ? "w-8 bg-app-ink/30" : "w-3 bg-app-ink/10"}`}
    />
  )
}

function Chip({ node, op, ed }: { node: AtomNode; op: Joiner; ed: Editor }) {
  const { cond } = node
  const label = conditionLabel(cond, ed.names)
  const Icon = CONDITION_ICON[cond.type]
  return (
    <span
      data-testid={`channel-filter-chip-${cond.type === "metric" ? `metric-${cond.metric}` : cond.value}`}
      data-not={!!node.not}
      {...dragProps(ed, node.id)}
      className={`${chipClass} cursor-grab active:cursor-grabbing ${node.not ? NEGATED : "border-app-ink/15"} ${ed.overId === node.id ? DROP : ""}`}
    >
      <NotToggle
        on={node.not}
        label={`Negate ${label}`}
        onClick={() => ed.onChange(toggleNot(ed.filter, node.id))}
      />
      <Icon size={10} aria-hidden />
      <ChannelConditionPicker
        start={cond}
        options={ed.options}
        metrics={ed.metrics}
        onPick={(next) => ed.onChange(replaceCond(ed.filter, node.id, next))}
        trigger={
          <button type="button" className="hover:underline">
            {label}
          </button>
        }
      />
      <button
        type="button"
        aria-label={`Put ${label} in parentheses`}
        title="Put in parentheses"
        onClick={() => ed.onChange(wrap(ed.filter, node.id, flip(op)))}
        className={iconButtonClass}
      >
        <Parentheses size={10} />
      </button>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={() => ed.onChange(removeNode(ed.filter, node.id))}
        className={iconButtonClass}
      >
        <X size={10} />
      </button>
    </span>
  )
}

/** A pair of parentheses: a box coloured by its depth, dragged as one. */
function Box({
  node,
  depth,
  ed,
}: {
  node: GroupNode
  depth: number
  ed: Editor
}) {
  return (
    <span
      data-testid="channel-filter-group"
      data-depth={depth}
      data-not={!!node.not}
      {...dragProps(ed, node.id)}
      className={`inline-flex cursor-grab flex-wrap items-center gap-1 rounded-lg border px-1 py-0.5 ${node.not ? NEGATED : DEPTH[depth % DEPTH.length]} ${ed.overId === node.id ? DROP : ""}`}
    >
      <NotToggle
        on={node.not}
        label="Negate these parentheses"
        onClick={() => ed.onChange(toggleNot(ed.filter, node.id))}
      />
      <Blocks group={node} depth={depth + 1} ed={ed} />
      {/* Dropping the parentheses of "not (a or b)" would change what it
          means, so a negated group keeps them. */}
      {!node.not && (
        <button
          type="button"
          aria-label="Remove these parentheses"
          title="Remove these parentheses"
          onClick={() => ed.onChange(unwrap(ed.filter, node.id))}
          className={iconButtonClass}
        >
          <Ungroup size={10} />
        </button>
      )}
    </span>
  )
}

/** A group's blocks, the joiners and gaps between them, and its "+". */
function Blocks({
  group,
  depth,
  ed,
}: {
  group: GroupNode
  depth: number
  ed: Editor
}) {
  const inside = group.id !== ed.filter.id
  return (
    <>
      {group.children.map((child, index) => (
        <Fragment key={child.id}>
          <Gap ed={ed} parentId={group.id} index={index} />
          {index > 0 && (
            <button
              type="button"
              title={`Switch to ${flip(group.op).toUpperCase()} for these parentheses`}
              onClick={() =>
                ed.onChange(setOp(ed.filter, group.id, flip(group.op)))
              }
              className={`rounded-md border px-1.5 text-[10px] font-bold uppercase hover:border-app-ink ${
                group.op === "or"
                  ? "border-app-ink/40 bg-app-ink/10 text-app-ink"
                  : "border-app-ink/15 text-app-ink/55"
              }`}
            >
              {group.op}
            </button>
          )}
          {child.kind === "atom" ? (
            <Chip node={child} op={group.op} ed={ed} />
          ) : (
            <Box node={child} depth={depth} ed={ed} />
          )}
        </Fragment>
      ))}
      <Gap ed={ed} parentId={group.id} index={group.children.length} />
      <ChannelConditionPicker
        options={ed.options}
        metrics={ed.metrics}
        onPick={(cond) => ed.onChange(append(ed.filter, group.id, cond))}
        trigger={
          <button
            type="button"
            aria-label={
              inside
                ? "Add a condition inside these parentheses"
                : "Add a condition"
            }
            className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-app-ink/25 text-app-ink/50 hover:border-app-ink hover:text-app-ink"
          >
            <Plus size={10} />
          </button>
        }
      />
    </>
  )
}

/**
 * The Channel filter row (CTB-01), under row 1 while anything filters the
 * grid: the "N of M" count, the search as a chip, then the whole filter as
 * blocks the Account edits (CTB-03). A joiner switches its group between AND
 * and OR, any block is negated, every pair of parentheses has its own "+",
 * and a block dropped on another goes in parentheses with it, or dropped in
 * a gap moves there.
 */
export function ChannelFilterRow({
  filter,
  onChange,
  names,
  metrics,
  options,
  search,
  shownCount,
  totalCount,
  onClearSearch,
  onClearAll,
}: ChannelFilterRowProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const searching = search.trim().length > 0
  const filters = atoms(filter).length + Number(searching)
  if (filters === 0) return null
  const ed: Editor = {
    filter,
    onChange,
    names,
    metrics,
    options,
    dragId,
    overId,
    setDragId,
    setOverId,
  }
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
        <span className={`${chipClass} border-app-ink/15 pl-2.5`}>
          <Search size={10} aria-hidden />"{search.trim()}"
          <button
            type="button"
            aria-label="Clear the search"
            onClick={onClearSearch}
            className={iconButtonClass}
          >
            <X size={10} />
          </button>
        </span>
      )}
      <span
        data-testid="channel-filter-blocks"
        data-not={!!filter.not}
        className={`inline-flex flex-wrap items-center gap-1 ${filter.not ? `rounded-lg border px-1 py-0.5 ${NEGATED}` : ""}`}
      >
        {filter.children.length > 0 && (
          <NotToggle
            on={filter.not}
            label="Negate the whole filter"
            onClick={() => onChange(toggleNot(filter, filter.id))}
          />
        )}
        <Blocks group={filter} depth={0} ed={ed} />
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
