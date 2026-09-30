/**
 * PROTOTYPE, throwaway: T1, the editor for the nested filter expression in
 * tree.ts, won over an outline (T2) and typed text (T3), which live in
 * e4d5002. It shows under row 1 and edits the same tree the dropdowns add to.
 */
import {
  Languages,
  Layers,
  Parentheses,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgInput } from "@/components/ui/tg-input"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import { cn } from "@/lib/utils"
import type { Joiner } from "./logic"
import { METRICS, type MetricKey } from "./metrics"
import { NumericEditor } from "./Numeric"
import { Pop, PopLabel } from "./Pop"
import {
  type AtomNode,
  append,
  type Cond,
  condLabel,
  emptyTree,
  type GroupNode,
  groupWith,
  moveNode,
  removeNode,
  replaceNode,
  setOp,
  toggleNot,
  unwrap,
  wrap,
} from "./tree"
import type { ChannelControlsProps } from "./types"

const flip = (op: Joiner): Joiner => (op === "and" ? "or" : "and")

// Parenthesis colours by depth, so matching pairs read at a glance.
const DEPTH = [
  { border: "border-sky-500/60", text: "text-sky-500", bg: "bg-sky-500/5" },
  {
    border: "border-violet-500/60",
    text: "text-violet-500",
    bg: "bg-violet-500/5",
  },
  {
    border: "border-amber-500/60",
    text: "text-amber-600",
    bg: "bg-amber-500/5",
  },
  {
    border: "border-emerald-500/60",
    text: "text-emerald-600",
    bg: "bg-emerald-500/5",
  },
]
const depthStyle = (d: number) => DEPTH[(d - 1) % DEPTH.length]

const TYPE_ICON: Record<Cond["type"], React.ReactNode> = {
  tag: <Tag size={10} />,
  group: <Layers size={10} />,
  language: <Languages size={10} />,
  metric: <SlidersHorizontal size={10} />,
}

// ---- Picking and editing one condition ----------------------------------

type PickStep = null | "tag" | "group" | "language" | { metric: MetricKey }

/** Step 1 names the kind of condition, step 2 its value. */
const PickerBody: React.FC<{
  p: ChannelControlsProps
  start?: Cond
  onPick: (c: Cond) => void
}> = ({ p, start, onPick }) => {
  const [step, setStep] = useState<PickStep>(
    start
      ? start.type === "metric"
        ? { metric: start.metric }
        : start.type
      : null,
  )
  const [q, setQ] = useState("")
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase())
  const back = () => {
    setStep(null)
    setQ("")
  }
  if (step && typeof step === "object")
    return (
      <NumericEditor
        p={p}
        metricKey={step.metric}
        initial={start?.type === "metric" ? start : undefined}
        onBack={start ? undefined : back}
        onDone={() => {}}
        onSubmit={(f) => onPick({ type: "metric", ...f })}
      />
    )
  const tags = [
    ...new Set(p.channels.flatMap((c) => getTagNames(c.tags))),
  ].sort()
  const rows: { key: string; label: string; cond: Cond; hint?: string }[] =
    step === "tag"
      ? [
          ...tags.map((t) => ({
            key: t,
            label: t,
            cond: { type: "tag", value: t } as Cond,
          })),
          ...p.pseudoTagChips.map((c) => ({
            key: c.id,
            label: c.label,
            hint: "derived",
            cond: { type: "tag", value: c.id } as Cond,
          })),
        ]
      : step === "group"
        ? p.groups.map((g) => ({
            key: g.id,
            label: g.name,
            cond: { type: "group", value: g.id } as Cond,
          }))
        : step === "language"
          ? p.allLanguages.map((l) => ({
              key: l.code,
              label: l.name,
              hint: l.code,
              cond: { type: "language", value: l.code } as Cond,
            }))
          : []
  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold hover:bg-app-ink/5"
  return (
    <div className="w-64">
      <TgInput
        autoFocus
        variant="muted"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={step ? `Search ${step}s…` : "Search conditions…"}
        className="mb-1 h-8 py-0 text-[11px]"
      />
      {step === null ? (
        <>
          {(
            [
              ["tag", "Tag", TYPE_ICON.tag],
              ["group", "Group", TYPE_ICON.group],
              ["language", "Language", TYPE_ICON.language],
            ] as const
          )
            .filter(([, l]) => match(l))
            .map(([k, l, icon]) => (
              <button
                key={k}
                type="button"
                className={item}
                onClick={() => setStep(k)}
              >
                {icon}
                {l}
                <span className="ml-auto text-app-ink/40">›</span>
              </button>
            ))}
          <PopLabel>Numbers</PopLabel>
          {METRICS.filter((m) => match(m.label)).map((m) => (
            <button
              key={m.key}
              type="button"
              className={item}
              onClick={() => setStep({ metric: m.key })}
            >
              {TYPE_ICON.metric}
              {m.label}
            </button>
          ))}
        </>
      ) : (
        <>
          {!start && (
            <button
              type="button"
              onClick={back}
              className="px-2 pb-1 text-[10px] font-semibold text-app-ink/50 hover:text-app-ink"
            >
              ← all conditions
            </button>
          )}
          {rows
            .filter((r) => match(r.label))
            .map((r) => (
              <button
                key={r.key}
                type="button"
                className={item}
                onClick={() => onPick(r.cond)}
              >
                {TYPE_ICON[r.cond.type]}
                {r.label}
                {r.hint && (
                  <span className="ml-auto text-app-ink/40">{r.hint}</span>
                )}
              </button>
            ))}
        </>
      )}
    </div>
  )
}

/** A trigger that opens the picker and closes once a condition is chosen. */
const Picker: React.FC<{
  p: ChannelControlsProps
  trigger: React.ReactNode
  start?: Cond
  onPick: (c: Cond) => void
}> = ({ p, trigger, start, onPick }) => {
  const [open, setOpen] = useState(false)
  return (
    <Pop open={open} onOpenChange={setOpen} trigger={trigger} className="p-2">
      {open && (
        <PickerBody
          p={p}
          start={start}
          onPick={(c) => {
            onPick(c)
            setOpen(false)
          }}
        />
      )}
    </Pop>
  )
}

const chip =
  "inline-flex h-6 items-center gap-1 rounded-full border border-app-ink/15 bg-app-card pl-2 pr-0.5 text-[10px] font-semibold"

/** One condition: click to change it, × to remove it. */
/** NOT on one node: faint "not" when off, a red NOT when on. */
const NotToggle: React.FC<{ on?: boolean; onClick: () => void }> = ({
  on,
  onClick,
}) => (
  <button
    type="button"
    aria-pressed={!!on}
    title={on ? "Remove NOT" : "Negate: match what this does not"}
    onClick={onClick}
    className={cn(
      "rounded px-1 text-[8px] font-bold uppercase tracking-widest",
      on
        ? "bg-red-500 text-white"
        : "text-app-ink/30 hover:bg-app-ink/10 hover:text-app-ink",
    )}
  >
    not
  </button>
)

const AtomChip: React.FC<{
  p: ChannelControlsProps
  node: AtomNode
  dragProps?: React.HTMLAttributes<HTMLSpanElement> & { draggable?: boolean }
  highlight?: boolean
  extra?: React.ReactNode
}> = ({ p, node, dragProps, highlight, extra }) => {
  const tree = p.filterTree
  return (
    <span
      {...dragProps}
      className={cn(
        chip,
        dragProps?.draggable && "cursor-grab active:cursor-grabbing",
        highlight && "ring-2 ring-app-ink/50",
        node.not && "border-red-500/50 bg-red-500/5",
      )}
    >
      <NotToggle
        on={node.not}
        onClick={() => p.onFilterTreeChange(toggleNot(tree, node.id))}
      />
      <span className="text-app-ink/45">{TYPE_ICON[node.cond.type]}</span>
      <Picker
        p={p}
        start={node.cond}
        onPick={(cond) =>
          p.onFilterTreeChange(replaceNode(tree, node.id, { ...node, cond }))
        }
        trigger={
          <button type="button" className="hover:underline">
            {condLabel(node.cond, p.treeNames)}
          </button>
        }
      />
      {extra}
      <button
        type="button"
        aria-label="Remove condition"
        onClick={() => p.onFilterTreeChange(removeNode(tree, node.id))}
        className="grid h-5 w-5 place-items-center rounded-full hover:bg-app-ink/15"
      >
        <X size={10} />
      </button>
    </span>
  )
}

const OpButton: React.FC<{
  op: Joiner
  onClick: () => void
  faint?: boolean
}> = ({ op, onClick, faint }) => (
  <button
    type="button"
    title={`Click for ${flip(op).toUpperCase()} (applies to this whole group)`}
    onClick={onClick}
    className={cn(
      "rounded-md border px-1.5 text-[9px] font-bold uppercase tracking-widest hover:border-app-ink",
      op === "or"
        ? "border-app-ink/40 bg-app-ink/10 text-app-ink"
        : "border-app-ink/15 text-app-ink/55",
      faint && "opacity-60",
    )}
  >
    {op}
  </button>
)

/** Count, search, the editor itself, Clear all. */
const BarShell: React.FC<{
  p: ChannelControlsProps
  children: React.ReactNode
  right?: React.ReactNode
}> = ({ p, children, right }) => (
  <div className="flex flex-wrap items-start gap-2 border-t border-app-ink/10 bg-app-muted/30 px-3 py-2">
    <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-app-ink/45">
      <Search size={10} />
      {p.filteredCount} of {p.totalCount}
    </span>
    {p.channelSearch.trim() && (
      <span className={chip}>
        <span className="text-app-ink/45">Search</span>“{p.channelSearch}”
        <button
          type="button"
          aria-label="Remove search"
          onClick={() => p.onChannelSearchChange("")}
          className="grid h-5 w-5 place-items-center rounded-full hover:bg-app-ink/15"
        >
          <X size={10} />
        </button>
      </span>
    )}
    <div className="min-w-0 flex-1">{children}</div>
    <div className="flex shrink-0 items-center gap-1">
      {right}
      {(p.filterTree.children.length > 0 || p.channelSearch.trim()) && (
        <button
          type="button"
          onClick={() => {
            p.onChannelSearchChange("")
            p.onFilterTreeChange(emptyTree())
          }}
          className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
        >
          <X size={11} /> Clear all
        </button>
      )}
    </div>
  </div>
)

// ---- T1: blocks you drag ------------------------------------------------

/**
 * Drag a chip onto another chip to put both in parentheses; drag it into a
 * gap to move it; the op between items flips the whole group. Every group
 * has its own "+" so a condition can start life nested.
 */
export const BlocksBar: React.FC<ChannelControlsProps> = (p) => {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const tree = p.filterTree
  const set = p.onFilterTreeChange
  const end = () => {
    setDragId(null)
    setOver(null)
  }

  // Plain render functions, not components: a component declared in here
  // would remount on every drag-over.
  const slot = (parentId: string, index: number) => {
    const key = `slot:${parentId}:${index}`
    if (!dragId) return null
    return (
      <span
        key={key}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(key)
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault()
          set(moveNode(tree, dragId, parentId, index))
          end()
        }}
        className={cn(
          "inline-block h-6 w-3 rounded transition-all",
          over === key ? "w-8 bg-app-ink/30" : "bg-app-ink/10",
        )}
      />
    )
  }

  const dragPropsFor = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // A chip sits inside its group's box, which is draggable too: without
      // this the outermost box wins and the whole group moves.
      e.stopPropagation()
      e.dataTransfer.setData("text/plain", id)
      e.dataTransfer.effectAllowed = "move"
      setDragId(id)
    },
    onDragEnd: end,
    onDragOver: (e: React.DragEvent) => {
      if (dragId && dragId !== id) {
        e.preventDefault()
        e.stopPropagation()
        setOver(id)
      }
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (dragId) set(groupWith(tree, dragId, id))
      end()
    },
  })

  const renderGroup = (g: GroupNode, depth: number): React.ReactNode => {
    const style = depth > 0 ? depthStyle(depth) : null
    const body = (
      <>
        {g.children.map((ch, i) => (
          <span key={ch.id} className="inline-flex items-center gap-1">
            {slot(g.id, i)}
            {i > 0 && (
              <OpButton
                op={g.op}
                onClick={() => set(setOp(tree, g.id, flip(g.op)))}
              />
            )}
            {ch.kind === "atom" ? (
              <AtomChip
                p={p}
                node={ch}
                dragProps={dragPropsFor(ch.id)}
                highlight={over === ch.id}
                extra={
                  <button
                    type="button"
                    title="Put in parentheses"
                    onClick={() => set(wrap(tree, ch.id, flip(g.op)))}
                    className="grid h-5 w-5 place-items-center rounded-full text-app-ink/40 hover:bg-app-ink/15 hover:text-app-ink"
                  >
                    <Parentheses size={10} />
                  </button>
                }
              />
            ) : (
              renderGroup(ch, depth + 1)
            )}
          </span>
        ))}
        {slot(g.id, g.children.length)}
        <Picker
          p={p}
          onPick={(cond) => set(append(tree, g.id, cond))}
          trigger={
            <button
              type="button"
              title={
                depth
                  ? "Add a condition inside these parentheses"
                  : "Add a condition"
              }
              className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-app-ink/25 text-app-ink/50 hover:border-app-ink hover:text-app-ink"
            >
              <Plus size={11} />
            </button>
          }
        />
      </>
    )
    if (!style)
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {g.children.length > 0 && (
            <NotToggle on={g.not} onClick={() => set(toggleNot(tree, g.id))} />
          )}
          {g.not && <span className="text-[14px] text-red-500">(</span>}
          {body}
          {g.not && <span className="text-[14px] text-red-500">)</span>}
        </span>
      )
    return (
      <span
        {...dragPropsFor(g.id)}
        className={cn(
          "group/paren inline-flex cursor-grab flex-wrap items-center gap-1 rounded-lg border px-1 py-0.5",
          style.border,
          style.bg,
          over === g.id && "ring-2 ring-app-ink/50",
          g.not && "border-red-500/60 bg-red-500/5",
        )}
      >
        <NotToggle on={g.not} onClick={() => set(toggleNot(tree, g.id))} />
        <span className={cn("text-[14px] font-light leading-none", style.text)}>
          (
        </span>
        {body}
        <span className={cn("text-[14px] font-light leading-none", style.text)}>
          )
        </span>
        {!g.not && (
          <button
            type="button"
            title="Remove these parentheses"
            onClick={() => set(unwrap(tree, g.id))}
            className="hidden h-5 w-5 place-items-center rounded-full text-app-ink/50 hover:bg-app-ink/15 group-hover/paren:grid"
          >
            <X size={10} />
          </button>
        )}
      </span>
    )
  }

  return (
    <BarShell
      p={p}
      right={
        <span className="hidden text-[9px] text-app-ink/40 lg:inline">
          drag onto a chip to group · into a gap to move
        </span>
      }
    >
      {renderGroup(tree, 0)}
    </BarShell>
  )
}
