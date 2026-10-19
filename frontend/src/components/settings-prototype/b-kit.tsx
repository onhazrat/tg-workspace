/**
 * PROTOTYPE, throw away. The pieces variant B is drawn with, every one of them
 * an existing workspace primitive or a copy of one that is private today:
 *
 * - on/off: `BarToggle` (Channels / Directory bar)
 * - a few choices: the inline segments of the Directory search (private there)
 * - many choices: `Pill` + `Options` (Posts filter bar)
 * - text and numbers: the `BarSearch` input class (Channels / Directory popovers)
 * - a list: the Directory table shell
 * - add / edit: a `pillClass` trigger opening a `BarPopover` form
 * - submit: `TgButton size="sm"`; destructive: `TgConfirmDialog`
 *
 * Nothing here is new styling. Folding B in means exporting Segments and the
 * table shell from where they live, not adding them.
 */
import { Plus } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { BarHeading, BarPopover } from "@/components/BarPopover"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { Options, Pill, pillClass } from "@/components/PostFilterParts"

export { BarHeading, BarPopover, BarToggle, Options, Pill, pillClass }

/** The `BarSearch` input, without the autofocus. */
export const fieldClass =
  "h-8 rounded-lg border border-app-ink/15 bg-app-muted px-2.5 text-xs outline-none focus:border-app-ink/40 disabled:opacity-50"

/** Directory's Name / Bio / Posts switch, for any short list of choices. */
export function Segments<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 inline-flex items-center gap-0.5 rounded-lg bg-app-ink/5 p-0.5 text-[11px]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1 ${o.value === value ? "bg-app-card font-semibold shadow-sm" : "text-app-ink/50 hover:text-app-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  )
}

/** A text or number field that commits on Enter or blur, Escape undoes. */
export function DraftField({
  value,
  onCommit,
  numeric,
  label,
  placeholder,
  invalid,
  className = "",
  type = "text",
}: {
  value: string
  onCommit: (value: string) => void
  numeric?: boolean
  label: string
  placeholder?: string
  invalid?: (draft: string) => boolean
  className?: string
  type?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const bad = invalid?.(draft) ?? false
  const commit = () => {
    if (!bad && draft !== value) onCommit(draft)
  }
  return (
    <input
      type={type}
      aria-label={label}
      aria-invalid={bad}
      inputMode={numeric ? "decimal" : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") commit()
        if (e.key === "Escape") setDraft(value)
      }}
      className={`${fieldClass} ${className.includes("w-") ? "" : numeric ? "w-24" : "w-full max-w-sm"} ${numeric ? "text-right tabular-nums" : ""} ${bad ? "border-red-500/60" : ""} ${className}`}
    />
  )
}

/** The Directory's table: a rounded card, quiet headers, hover rows. */
export function ListTable({
  columns,
  children,
  empty,
  isEmpty,
}: {
  columns: { label: string; className?: string }[]
  children: React.ReactNode
  empty: string
  isEmpty: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-app-ink/10 bg-app-card">
      <table className="w-full text-xs">
        <thead className="text-left text-[11px] text-app-ink/60">
          <tr>
            {columns.map((c) => (
              <th
                key={c.label}
                className={`px-3 py-2 font-normal ${c.className ?? ""}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr className="border-t border-app-ink/5">
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
      </table>
    </div>
  )
}

export const rowClass = "border-t border-app-ink/5 hover:bg-app-ink/5"
export const cellClass = "px-3 py-2"

/** The `+ Follow` / `+ Add to Directory` pill and the form it opens. */
export function AddPill({
  label,
  heading,
  children,
  open,
  onOpenChange,
  width = "w-80",
}: {
  label: string
  heading: string
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  width?: string
}) {
  return (
    <BarPopover
      width={width}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button type="button" className={pillClass(false)}>
          <Plus size={12} /> {label}
        </button>
      }
    >
      <BarHeading>{heading}</BarHeading>
      <div className="space-y-2 px-1 pb-1">{children}</div>
    </BarPopover>
  )
}

/** Green / amber / red dot and its words, as Directory status cells read. */
export function Status({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "off"
  children: React.ReactNode
}) {
  const dot = {
    ok: "bg-green-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    off: "bg-app-ink/25",
  }[tone]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

export function FormError({ children }: { children: React.ReactNode }) {
  return children ? (
    <p className="px-1 text-[11px] text-red-500">{children}</p>
  ) : null
}
