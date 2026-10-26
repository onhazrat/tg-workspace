/**
 * "N missing": Covered Posts an Artifact's prompt left out (ADR-038).
 *
 * Shown after the Scope's other numbers, absent at zero. Tapping it opens the
 * explanation as a full-width line below rather than a popover, so it wraps
 * inside the viewport at phone width wherever the chip sits.
 */

import { useState } from "react"

export function MissingPostsChip({
  count,
  covered,
}: {
  count: number | null | undefined
  /** How many Posts the Artifact lists as covered, when known. */
  covered?: number | null
}) {
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <>
      {" "}
      <button
        type="button"
        data-testid="missing-posts-chip"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[0.85em] text-amber-700 dark:text-amber-400"
      >
        {count.toLocaleString()} missing
      </button>
      {open && (
        <span
          data-testid="missing-posts-explanation"
          className="mt-1 block w-full max-w-full basis-full break-words text-xs text-app-ink/70"
        >
          {count.toLocaleString()} Covered Posts
          {covered == null ? "" : ` of ${covered.toLocaleString()}`} are
          missing. Retention reclaimed them, or you no longer follow their
          Channel. They are still listed as covered; the prompt left them out.
        </span>
      )}
    </>
  )
}
