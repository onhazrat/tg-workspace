import {
  ChevronDown,
  Filter,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import type React from "react"
import { useState } from "react"
import { BarHeading, BarPopover, BarSearch } from "@/components/BarPopover"
import { pillClass } from "@/components/PostFilterParts"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"

/** One value in a facet dropdown, with how much of it is selected. */
export type FacetMenuRow = {
  id: string
  label: string
  hint?: string
  /** A derived tag's explanation; such rows are listed under "Derived". */
  explanation?: string
  /** The selected members of the row, and all of them. */
  selected: number
  total: number
  /** The tick: all of the row selected, some, or none. */
  tick: "true" | "mixed" | "false"
  /** The tick is being resolved, as a Posts tick will ask the server. */
  busy?: boolean
}

type FacetMenuProps = {
  icon?: React.ReactNode
  /** The dropdown's name, "Groups". */
  label: string
  /** One row's kind, "group". */
  noun: string
  testId: string
  rows: FacetMenuRow[]
  /** The row ids funnelled into the filter. */
  funnelled: string[]
  /** A funnelled id's name, including one the search has hidden. */
  labelOf: (id: string) => string
  /**
   * A tick that selects every member of the row. Without one the rows have
   * no tick column and the count is the row's `total` alone, as on the Posts
   * tab until its ticks record Selection rules (PTR-06).
   */
  onToggleSelect?: (row: FacetMenuRow) => void
  onFunnel: (id: string, on: boolean) => void
  onClearFunnels: () => void
  /**
   * A search the caller owns and has already narrowed `rows` by, as the tag
   * search does. Without one the dropdown keeps and applies its own.
   */
  search?: { value: string; onChange: (value: string) => void }
  /** The line over the rows; what a tick selects differs by tab. */
  tickHint?: string
  /** Called as the dropdown opens and closes, so a tab can load its counts then. */
  onOpenChange?: (open: boolean) => void
  /** What a row's count is out of, without ticks: "in the window". */
  countLabel?: string
  /**
   * Offer to create the searched name when no row has it, as the Groups
   * dropdown does. Resolves true once created, which clears the search.
   */
  onCreate?: (name: string) => Promise<boolean>
  /**
   * PROTOTYPE (channel-tags-usage): rename and delete a row, as icons that
   * brighten on hover. `can` leaves derived and `group:` rows out.
   */
  /** PROTOTYPE: which edge the dropdown opens from. */
  align?: "start" | "end"
  manage?: {
    can: (row: FacetMenuRow) => boolean
    onRename: (id: string, to: string) => void
    onDelete: (id: string) => void
    deleteText: (row: FacetMenuRow) => string
    /** A rename that would merge two Tags, said so; undefined renames at once. */
    mergeText?: (id: string, to: string) => string | undefined
  }
  /** PROTOTYPE: keep the rows' order while open, so a click never moves a row. */
  freezeOrder?: boolean
  /**
   * PROTOTYPE: a row's other actions sit between its name and its count (the
   * Groups gear, rename, delete). The tick is always leftmost, the funnel
   * always rightmost.
   */
  rowAction?: RowAction
  /** PROTOTYPE: a selection action without a tick, leftmost: the Directory's tick-exactly. */
  selectAction?: RowAction
}

type RowAction = {
  icon: React.ReactNode
  label: (row: FacetMenuRow) => string
  onClick: (row: FacetMenuRow) => void
}

function Tick({ row }: { row: FacetMenuRow }) {
  return (
    <span
      aria-hidden
      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border text-[9px] leading-none ${
        row.tick === "true"
          ? "border-app-ink bg-app-ink text-app-bg"
          : row.tick === "mixed"
            ? "border-app-ink/60 bg-app-ink/20"
            : "border-app-ink/30"
      }`}
    >
      {row.busy ? (
        <Loader2 size={9} className="animate-spin" />
      ) : row.tick === "true" ? (
        "✓"
      ) : row.tick === "mixed" ? (
        "–"
      ) : (
        ""
      )}
    </span>
  )
}

function RowLabel({ row }: { row: FacetMenuRow }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold">
        {row.label}
        {row.hint && (
          <span className="ml-1.5 font-normal text-app-ink/40">{row.hint}</span>
        )}
      </span>
      {row.explanation && (
        <span className="block text-[11px] text-app-ink/50">
          {row.explanation}
        </span>
      )}
    </span>
  )
}

/**
 * A facet dropdown (CTB-01): a search, then a row per value with a tick that
 * selects every member of it, `selected/total` and a funnel that filters the
 * list to it. Each tab counts its own rows; Channels' Groups, Tags and
 * Languages are this one component.
 */
export function FacetMenu({
  icon,
  label,
  noun,
  testId,
  rows,
  funnelled,
  labelOf,
  onToggleSelect,
  onFunnel,
  onClearFunnels,
  search,
  tickHint = "Tick selects, the funnel shows only",
  countLabel = "in the window",
  onOpenChange,
  onCreate,
  manage,
  rowAction,
  selectAction,
  align,
  freezeOrder,
}: FacetMenuProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [deleting, setDeleting] = useState<FacetMenuRow | null>(null)
  const [merging, setMerging] = useState<{
    id: string
    to: string
    text: string
  } | null>(null)
  // The order as the dropdown opened; rows it did not have go last.
  const [frozen, setFrozen] = useState<string[] | null>(null)
  const ticks = onToggleSelect !== undefined
  const [ownQuery, setOwnQuery] = useState("")
  const query = search ? search.value : ownQuery
  const needle = query.trim().toLowerCase()
  const matched = search
    ? rows
    : rows.filter((row) =>
        `${row.label} ${row.hint ?? ""}`.toLowerCase().includes(needle),
      )
  const place = (id: string) => {
    const at = frozen?.indexOf(id) ?? -1
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  const shown = frozen
    ? [...matched].sort((a, b) => place(a.id) - place(b.id))
    : matched
  const withSelection = ticks
    ? rows.filter((row) => row.selected > 0).length
    : 0
  const title =
    funnelled.length > 1
      ? `${funnelled.length} ${label.toLowerCase()}`
      : funnelled.length === 1
        ? labelOf(funnelled[0])
        : label
  const active = funnelled.length > 0
  const name = query.trim()
  const canCreate =
    onCreate !== undefined &&
    name !== "" &&
    !rows.some((row) => row.label.toLowerCase() === name.toLowerCase())
  const [creating, setCreating] = useState(false)
  const create = async () => {
    if (!onCreate) return
    setCreating(true)
    try {
      if (await onCreate(name)) {
        if (search) search.onChange("")
        else setOwnQuery("")
      }
    } finally {
      setCreating(false)
    }
  }

  const iconButton =
    "grid h-6 w-6 place-items-center rounded text-app-ink/40 hover:bg-app-ink/10 hover:text-app-ink"
  const hoverOnly =
    "opacity-30 group-hover:opacity-100 focus-visible:opacity-100"
  return (
    <>
      <BarPopover
        align={align}
        width="w-80"
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
          setFrozen(open && freezeOrder ? rows.map((r) => r.id) : null)
          onOpenChange?.(open)
        }}
        trigger={
          <button
            type="button"
            data-testid={testId}
            data-active={active}
            className={pillClass(active)}
          >
            {icon}
            <span className="max-w-40 truncate">{title}</span>
            {withSelection > 0 && (
              <span className="rounded-full bg-app-ink/15 px-1.5 text-[10px] tabular-nums">
                {withSelection}
              </span>
            )}
            <ChevronDown size={12} className="opacity-60" />
          </button>
        }
      >
        <BarSearch
          value={query}
          onChange={search ? search.onChange : setOwnQuery}
          placeholder={`Search ${label.toLowerCase()}...`}
        />
        <div className="flex justify-between px-2 pb-1 pt-1 text-[11px] text-app-ink/50">
          <span>{ticks ? tickHint : "The funnel shows only"}</span>
          <span>{ticks ? "selected/total" : countLabel}</span>
        </div>
        {active && (
          <button
            type="button"
            onClick={onClearFunnels}
            className="mb-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-app-ink/60 hover:bg-app-ink/5 hover:text-app-ink"
          >
            <X size={11} /> Clear {funnelled.length} funnel
            {funnelled.length > 1 ? "s" : ""}
          </button>
        )}
        {shown.length === 0 && (
          <p className="px-2 py-3 text-app-ink/50">
            No {noun} matches {query.trim()}
          </p>
        )}
        {shown.map((row, index) => {
          const on = funnelled.includes(row.id)
          const heading = row.explanation && !shown[index - 1]?.explanation
          return (
            <div key={row.id}>
              {heading && <BarHeading>Derived</BarHeading>}
              <div className="group flex items-center gap-1 rounded-md hover:bg-app-ink/5">
                {renaming === row.id ? (
                  <form
                    className="flex-1 px-1 py-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const to = draft.trim()
                      const merge =
                        to && to !== row.label
                          ? manage?.mergeText?.(row.id, to)
                          : undefined
                      if (merge) setMerging({ id: row.id, to, text: merge })
                      else if (to && to !== row.label)
                        manage?.onRename(row.id, to)
                      setRenaming(null)
                    }}
                  >
                    <input
                      // biome-ignore lint/a11y/noAutofocus: opened to type the new name.
                      autoFocus
                      aria-label={`New name for ${row.label}`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Escape") setRenaming(null)
                      }}
                      className="h-7 w-full rounded-md border border-app-ink/20 bg-app-muted px-2"
                    />
                  </form>
                ) : ticks ? (
                  // biome-ignore lint/a11y/useSemanticElements: a native checkbox cannot say "mixed" without a ref, and a partly selected row must.
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={row.tick}
                    disabled={row.busy}
                    data-testid={`${testId}-row-${row.id}`}
                    onClick={() => onToggleSelect(row)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                  >
                    <Tick row={row} />
                    <RowLabel row={row} />
                  </button>
                ) : (
                  <>
                    {selectAction && (
                      <button
                        type="button"
                        aria-label={selectAction.label(row)}
                        title={selectAction.label(row)}
                        onClick={() => selectAction.onClick(row)}
                        className={`${iconButton} ml-1`}
                      >
                        {selectAction.icon}
                      </button>
                    )}
                    <span
                      data-testid={`${testId}-row-${row.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
                    >
                      <RowLabel row={row} />
                    </span>
                  </>
                )}
                {rowAction && renaming !== row.id && (
                  <button
                    type="button"
                    aria-label={rowAction.label(row)}
                    title={rowAction.label(row)}
                    onClick={() => rowAction.onClick(row)}
                    className={iconButton}
                  >
                    {rowAction.icon}
                  </button>
                )}
                {manage?.can(row) && renaming !== row.id && (
                  <>
                    <button
                      type="button"
                      aria-label={`Rename ${row.label}`}
                      title="Rename"
                      onClick={() => {
                        setRenaming(row.id)
                        setDraft(row.label)
                      }}
                      className={`${iconButton} ${hoverOnly}`}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${row.label}`}
                      title="Delete"
                      onClick={() => setDeleting(row)}
                      className={`${iconButton} ${hoverOnly} hover:text-red-600`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
                {
                  <>
                    <span
                      data-testid={`${testId}-count-${row.id}`}
                      className="font-mono text-[10px] text-app-ink/50"
                    >
                      {ticks ? `${row.selected}/${row.total}` : row.total}
                    </span>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={
                        on
                          ? `Stop showing only ${row.label}`
                          : `Show only ${row.label}`
                      }
                      title={
                        on ? `Stop showing only this ${noun}` : "Show only this"
                      }
                      data-testid={`${testId}-funnel-${row.id}`}
                      onClick={() => onFunnel(row.id, !on)}
                      className={`mr-1 grid h-6 w-6 place-items-center rounded ${
                        on
                          ? "bg-app-ink text-app-bg"
                          : "text-app-ink/40 hover:bg-app-ink/10 hover:text-app-ink"
                      }`}
                    >
                      <Filter size={11} />
                    </button>
                  </>
                }
              </div>
            </div>
          )
        })}
        {canCreate && (
          <button
            type="button"
            disabled={creating}
            data-testid={`${testId}-create`}
            onClick={() => void create()}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t border-app-ink/10 px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Plus size={11} />
            )}
            <span className="truncate">
              Create {noun} "{name}"
            </span>
          </button>
        )}
        {onCreate && name === "" && (
          <p className="mt-1 border-t border-app-ink/10 px-2 pt-1.5 text-[11px] text-app-ink/50">
            Type a name to create a {noun}
          </p>
        )}
      </BarPopover>
      {manage && (
        <TgConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => open || setDeleting(null)}
          title={`Delete the ${noun}?`}
          description={deleting ? manage.deleteText(deleting) : ""}
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => {
            if (deleting) manage.onDelete(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
      {manage && (
        <TgConfirmDialog
          open={merging !== null}
          onOpenChange={(open) => open || setMerging(null)}
          title={`Merge the ${noun}s?`}
          description={merging?.text ?? ""}
          confirmLabel="Merge"
          variant="destructive"
          onConfirm={() => {
            if (merging) manage.onRename(merging.id, merging.to)
            setMerging(null)
          }}
          onCancel={() => setMerging(null)}
        />
      )}
    </>
  )
}
