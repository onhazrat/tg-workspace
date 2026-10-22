/**
 * The list tabs' bar shell, lifted out of the Directory bar: the search box on
 * top, a wrapping row of controls, an optional band under it, and a footer.
 * Below `md` the controls fold into a full-screen "Filters and sort" sheet
 * behind one button beside the search box, which says how many are on.
 * The Directory and History use it; the Posts bar moves onto it later.
 */
import { ListFilter } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { pillClass } from "@/components/PostFilterParts"

export function FilterBar({
  search,
  controls,
  sheetLead,
  band,
  footer,
  phone = false,
  active,
  testIdPrefix,
}: {
  search: React.ReactNode
  controls: React.ReactNode
  /** On a phone, above the controls in the sheet. */
  sheetLead?: React.ReactNode
  /** Between the controls and the footer: the Directory's filter row. */
  band?: React.ReactNode
  footer: React.ReactNode
  phone?: boolean
  /** How many controls are on, for the phone's button. */
  active: number
  /** `<prefix>-controls-button` and `<prefix>-footer`. */
  testIdPrefix: string
}) {
  const [sheet, setSheet] = useState(false)
  return (
    <section className="mb-3 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
      {phone ? (
        <div className="flex items-center gap-2 px-4 pt-4">
          <div className="min-w-0 flex-1">{search}</div>
          <button
            type="button"
            data-testid={`${testIdPrefix}-controls-button`}
            aria-label={`Filters and sort${active > 0 ? `, ${active} on` : ""}`}
            onClick={() => setSheet(true)}
            className={`${pillClass(active > 0)} h-9 shrink-0`}
          >
            <ListFilter size={14} />
            {active > 0 ? active : "Filters"}
          </button>
        </div>
      ) : (
        <div className="px-4 pt-4">{search}</div>
      )}
      {!phone && (
        <div className="flex flex-wrap items-center gap-2 p-4">{controls}</div>
      )}
      {phone && sheet && (
        // z-40 covers the list; the controls' popovers open at z-50, above it.
        <div
          role="dialog"
          aria-label="Filters and sort"
          className="fixed inset-0 z-40 flex flex-wrap content-start items-center gap-2.5 overflow-y-auto bg-app-bg p-4 pb-24"
        >
          <div className="mb-1 flex w-full items-center justify-between">
            <b className="text-sm">Filters and sort</b>
            <button
              type="button"
              onClick={() => setSheet(false)}
              className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white"
            >
              Done
            </button>
          </div>
          {sheetLead}
          {controls}
        </div>
      )}

      {band}

      <div
        data-testid={`${testIdPrefix}-footer`}
        className="flex flex-wrap items-center gap-2 border-t border-app-ink/5 bg-app-muted/30 px-4 py-2.5 text-xs"
      >
        {footer}
      </div>
    </section>
  )
}
