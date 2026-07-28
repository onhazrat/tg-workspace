/**
 * Shared vertical rhythm for the Channels tab control rows.
 *
 * Every control that sits directly on a row is 36px tall (`h-9`); anything
 * nested inside a bordered group pill is 28px (`h-7`), which centres it with
 * 3px of breathing room on each side. Keeping these in one place stops the
 * toolbar, filter bar, and bulk-action bar from drifting apart again.
 */

/** Control sitting directly on a row: input, button, or select. */
export const controlRowItemClassName = "h-9"

/**
 * Bordered pill grouping a label with its related controls. Sits at the shared
 * height on one line and grows instead of overflowing when a narrow viewport
 * forces its contents to wrap.
 */
export const controlGroupClassName =
  "flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/40 px-2.5 py-0.5"

/**
 * Group pill whose contents may wrap onto more lines on narrow viewports, so it
 * grows from the shared height instead of being pinned to it.
 */
export const controlWrapGroupClassName =
  "flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-app-ink/10 bg-app-muted/40 px-2.5 py-0.5"

/** Caption prefixing the controls inside a group pill. */
export const controlGroupLabelClassName =
  "whitespace-nowrap text-[9px] font-bold uppercase tracking-wide text-app-ink/50"

/** Control nested inside a group pill. */
export const controlGroupItemClassName = "h-7"

/** Vertical hairline separating clusters within a row. */
export const controlSeparatorClassName = "h-5 w-px shrink-0 bg-app-ink/10"
