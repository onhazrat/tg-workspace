import type * as React from "react"

/**
 * The Directory's table: a rounded card that scrolls sideways, small text,
 * quiet headers. Rows start from `tgTableRowClass` and add their own states.
 */
function TgTableCard({
  children,
  after,
}: {
  children: React.ReactNode
  /** Inside the card, below the table: a pager or a "load more". */
  after?: React.ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-app-ink/10 bg-app-card">
      <table className="w-full text-xs">{children}</table>
      {after}
    </div>
  )
}

const tgTableHeadClass = "text-left text-[11px] text-app-ink/60"
const tgTableRowClass = "border-t border-app-ink/5"

export { TgTableCard, tgTableHeadClass, tgTableRowClass }
