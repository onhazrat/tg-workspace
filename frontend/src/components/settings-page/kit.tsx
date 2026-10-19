/**
 * What the Settings panels are drawn with (SET-03). Every piece is an existing
 * workspace primitive or a thin arrangement of them, the way the Directory
 * draws its own:
 *
 * - a list: `TgTableCard` with its head and row classes
 * - add / edit: a `pillClass` trigger opening a `BarPopover` form
 * - text in a form: the `BarSearch` input class, without the autofocus
 * - submit: `TgButton size="sm"`; destructive: `TgConfirmDialog`
 *
 * Writes in panels stay explicit (decision 22): a form has a button, and a
 * destructive action asks.
 */
import { Plus, Trash2 } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { BarHeading, BarPopover, barInputClass } from "@/components/BarPopover"
import { pillClass } from "@/components/PostFilterParts"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import {
  TgTableCard,
  tgTableHeadClass,
  tgTableRowClass,
} from "@/components/ui/tg-table-card"
import { extractErrorMessage } from "@/utils"

/** The `BarSearch` input, without the autofocus. */
export const fieldClass = barInputClass

export const rowClass = `${tgTableRowClass} hover:bg-app-ink/5`
export const cellClass = "px-3 py-2"

/** The server's words for a refusal, or the error's own. */
export const errorOf = extractErrorMessage

/** `TgTableCard` with a header row and an empty state. */
export function ListTable({
  columns,
  children,
  empty,
  isEmpty,
  testId,
}: {
  columns: { label: string; className?: string }[]
  children: React.ReactNode
  empty: string
  isEmpty: boolean
  testId?: string
}) {
  return (
    <div data-testid={testId}>
      <TgTableCard>
        <thead className={tgTableHeadClass}>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.label || i}
                className={`px-3 py-2 font-normal ${c.className ?? ""}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr className={tgTableRowClass}>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-app-ink/50"
              >
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </TgTableCard>
    </div>
  )
}

/** A pill opening a form in a `BarPopover`: `+ Add key`, `Change password`. */
export function FormPill({
  label,
  heading,
  children,
  open,
  onOpenChange,
  icon = <Plus size={12} />,
  width = "w-80",
  ariaLabel,
}: {
  label: string
  /** The trigger's accessible name, when its words repeat on every row. */
  ariaLabel?: string
  heading: string
  children: React.ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  icon?: React.ReactNode
  width?: string
}) {
  return (
    <BarPopover
      width={width}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          className={pillClass(false)}
        >
          {icon} {label}
        </button>
      }
    >
      <BarHeading>{heading}</BarHeading>
      <div className="space-y-2 px-1 pb-1">{children}</div>
    </BarPopover>
  )
}

const TONES = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  off: "bg-app-ink/25",
} as const

/** A dot and its words, as the Directory's status cells read. */
export function Status({
  tone,
  children,
}: {
  tone: keyof typeof TONES
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONES[tone]}`} />
      {children}
    </span>
  )
}

export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return <p className="px-1 text-[11px] text-red-500">{children}</p>
}

/**
 * A button that asks in `TgConfirmDialog` before it acts. A refusal keeps the
 * question open with the server's reason in it; success closes it.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  trigger,
}: {
  /** The trigger's accessible name; the trash icon shows it as a tooltip. */
  label: string
  title: string
  description?: string
  confirmLabel: string
  onConfirm: () => Promise<unknown>
  /** Drawn instead of the trash icon; gets the click. */
  trigger?: (open: () => void) => React.ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const open = () => {
    setError("")
    setAsking(true)
  }
  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      setAsking(false)
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {trigger ? (
        trigger(open)
      ) : (
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={open}
          className="rounded-md p-1 text-app-ink/40 hover:bg-red-500/10 hover:text-red-500"
        >
          <Trash2 size={13} />
        </button>
      )}
      <TgConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        variant="destructive"
        loading={busy}
        onConfirm={confirm}
      >
        {error && <p className="px-4 pt-3 text-xs text-red-500">{error}</p>}
      </TgConfirmDialog>
    </>
  )
}

/**
 * A text field that commits on Enter or blur and undoes on Escape, as a row
 * does. `invalid` refuses a draft before it is sent and says why.
 */
export function PanelField({
  label,
  value,
  onCommit,
  invalid,
  placeholder,
  type = "text",
  className = "w-72 max-w-full",
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  invalid?: (draft: string) => string | null
  placeholder?: string
  type?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const refusal = invalid?.(draft) ?? null
    setShown(refusal)
    if (!refusal && draft !== value) onCommit(draft)
  }
  return (
    <span className="inline-flex max-w-full flex-col gap-1">
      <input
        type={type}
        aria-label={label}
        aria-invalid={Boolean(shown)}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setDraft(value)
            setShown(null)
          }
        }}
        className={`${fieldClass} ${className} ${shown ? "border-red-500/60" : ""}`}
      />
      <FormError>{shown}</FormError>
    </span>
  )
}

/** A labelled input inside a popover form. */
export function FormInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  onEnter,
  className = "",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  onEnter?: () => void
  className?: string
}) {
  return (
    <input
      type={type}
      aria-label={label}
      placeholder={placeholder ?? label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") onEnter?.()
      }}
      className={`${fieldClass} w-full ${className}`}
    />
  )
}

/** A small pill-shaped action in a table row: Check, Test, Lift today. */
export function RowAction({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  /** The accessible name and tooltip, when the words alone are ambiguous. */
  label?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`${pillClass(false)} px-2 py-1 text-[11px] disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

/** Small grey words under a table: what an empty box means, where a value comes from. */
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-[11px] text-app-ink/50">{children}</p>
}
