/**
 * Shared trigger styling for compact selects on the Channels tab.
 *
 * `SelectTrigger` sets its height through `data-[size=…]` variants, which
 * out-specify a plain `h-*` utility — so this overrides the same variant and
 * must be paired with `size="sm"` to land on the 28px control rhythm.
 */
export const selectTriggerClassName =
  "data-[size=sm]:h-7 w-auto min-w-[96px] rounded-md border-app-ink/15 bg-app-card/70 px-2 text-[10px] font-bold uppercase tracking-widest text-app-ink shadow-none focus-visible:ring-app-ink/30 data-[placeholder]:text-app-ink/50"
