/**
 * A facet row's rename and delete, and its one other action (TGU-02).
 *
 * Rename and delete are icons that brighten on hover; a derived row (one with
 * an explanation, as Untagged) has neither. Delete always asks, naming the
 * channel count. A rename asks only when `mergeText` says it would merge two
 * rows, and renames only once confirmed, because a merge cannot be undone.
 */
import { Pencil, Trash2 } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import type { FacetMenuRow } from "./FacetMenu"

export type FacetManage = {
  onRename: (id: string, to: string) => void
  onDelete: (id: string) => void
  /** What deleting the row takes away, for its confirmation. */
  deleteText: (row: FacetMenuRow) => string
  /** What renaming `id` to `to` would merge, said so; undefined renames at once. */
  mergeText?: (id: string, to: string) => string | undefined
}

export type FacetRowAction = {
  icon: React.ReactNode
  label: (row: FacetMenuRow) => string
  onClick: (row: FacetMenuRow) => void
}

type Merge = { id: string; to: string; text: string }

/** The rename in progress, and the delete and merge awaiting confirmation. */
export function useFacetManage(manage: FacetManage | undefined) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [deleting, setDeleting] = useState<FacetMenuRow | null>(null)
  const [merging, setMerging] = useState<Merge | null>(null)
  const submit = (row: FacetMenuRow) => {
    setRenaming(null)
    const to = draft.trim()
    if (!manage || to === "" || to === row.label) return
    const text = manage.mergeText?.(row.id, to)
    if (text) setMerging({ id: row.id, to, text })
    else manage.onRename(row.id, to)
  }
  return {
    manage,
    renaming,
    draft,
    setDraft,
    deleting,
    setDeleting,
    merging,
    setMerging,
    submit,
    startRenaming: (row: FacetMenuRow) => {
      setRenaming(row.id)
      setDraft(row.label)
    },
    stopRenaming: () => setRenaming(null),
  }
}

type Managing = ReturnType<typeof useFacetManage>

const iconButton =
  "grid h-6 w-6 shrink-0 place-items-center rounded text-app-ink/40 hover:bg-app-ink/10 hover:text-app-ink"
const hoverOnly = "opacity-30 group-hover:opacity-100 focus-visible:opacity-100"

export function RenameForm({
  row,
  managing,
}: {
  row: FacetMenuRow
  managing: Managing
}) {
  return (
    <form
      className="flex-1 px-1 py-1"
      onSubmit={(event) => {
        event.preventDefault()
        managing.submit(row)
      }}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: opened to type the new name.
        autoFocus
        aria-label={`New name for ${row.label}`}
        value={managing.draft}
        onChange={(event) => managing.setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === "Escape") managing.stopRenaming()
        }}
        className="h-7 w-full rounded-md border border-app-ink/20 bg-app-muted px-2"
      />
    </form>
  )
}

/** The row's own action, then rename and delete: between its name and count. */
export function FacetManageButtons({
  row,
  rowAction,
  managing,
}: {
  row: FacetMenuRow
  rowAction?: FacetRowAction
  managing: Managing
}) {
  const manageable = managing.manage !== undefined && !row.explanation
  return (
    <>
      {rowAction && (
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
      {manageable && (
        <>
          <button
            type="button"
            aria-label={`Rename ${row.label}`}
            title="Rename"
            onClick={() => managing.startRenaming(row)}
            className={`${iconButton} ${hoverOnly}`}
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${row.label}`}
            title="Delete"
            onClick={() => managing.setDeleting(row)}
            className={`${iconButton} ${hoverOnly} hover:text-red-600`}
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </>
  )
}

export function FacetManageDialogs({
  managing,
  noun,
  testId,
}: {
  managing: Managing
  noun: string
  testId: string
}) {
  const { manage, deleting, merging } = managing
  if (!manage) return null
  return (
    <>
      <TgConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => open || managing.setDeleting(null)}
        title={`Delete the ${noun}?`}
        description={deleting ? manage.deleteText(deleting) : ""}
        confirmLabel="Delete"
        variant="destructive"
        confirmTestId={`${testId}-delete-confirm`}
        onConfirm={() => {
          if (deleting) manage.onDelete(deleting.id)
          managing.setDeleting(null)
        }}
      />
      <TgConfirmDialog
        open={merging !== null}
        onOpenChange={(open) => open || managing.setMerging(null)}
        title={`Merge the ${noun}s?`}
        description={merging?.text ?? ""}
        confirmLabel="Merge"
        variant="destructive"
        confirmTestId={`${testId}-merge-confirm`}
        onConfirm={() => {
          if (merging) manage.onRename(merging.id, merging.to)
          managing.setMerging(null)
        }}
      />
    </>
  )
}
